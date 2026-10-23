import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 认证路由：登录、注册、续费、修改密码、当前用户信息。
 * 多用户模型：validateUser 按 users.json 校验，登录成功把用户对象放进 ctx.tokenUserMap。
 */
const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const userStore = require('../../models/user-store');

const {
    getClientIp,
    issueToken,
    createAuthRequired,
    checkAccountAccess,
    ensureAccountAccess,
    resolveAccId,
    getAccId,
    handleApiError,
} = require('./middleware');

const adminLogger = createModuleLogger('admin');

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    // 登录
    app.post('/api/login', (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
        }

        const clientIp = getClientIp(req);
        const userAgent = String(req.headers['user-agent'] || 'unknown');
        const result = userStore.validateUser(String(username), String(password), clientIp);

        if (result?.error) {
            const statusCode = result.error === 'rate_limit' ? 429 : result.error === 'locked' ? 423 : 401;
            adminLogger.warn('登录失败', { username, error: result.error, ip: clientIp });
            userStore.addLoginLog({
                event: 'login_failed',
                username: String(username),
                errorType: result.error,
                ip: clientIp,
                userAgent,
            });
            return res.status(statusCode).json({
                ok: false,
                error: result.message,
                errorType: result.error,
                remainingMs: result.remainingMs,
            });
        }

        if (!result) {
            return res.status(401).json({ ok: false, error: '用户名或密码错误' });
        }

        // 封禁 / 过期检查（管理员豁免）
        if (result.role !== 'admin') {
            if (result.card && result.card.enabled === false) {
                return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
            }
            if (result.card && result.card.expiresAt && result.card.expiresAt < Date.now()) {
                return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
            }
        }

        const token = issueToken();
        ctx.tokens.add(token);
        ctx.tokenUserMap.set(token, {
            username: result.username,
            role: result.role,
            card: result.card || null,
            accountLimit: result.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT,
        });

        adminLogger.info('登录成功', { username: result.username, role: result.role, ip: clientIp });
        userStore.addLoginLog({
            event: 'login_success',
            username: result.username,
            errorType: null,
            ip: clientIp,
            userAgent,
        });

        return res.json({
            ok: true,
            data: {
                token,
                role: result.role,
                card: result.card || null,
                accountLimit: result.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT,
                user: { username: result.username },
                mustChangePassword: result.mustChangePassword === true,
            },
        });
    });

    // 注册（需要有效的时间卡密）
    app.post('/api/register', (req: Request, res: Response) => {
        const { username, password, cardCode } = req.body || {};
        if (!username || !password || !cardCode) {
            return res.status(400).json({ ok: false, error: '请填写完整信息' });
        }
        const result = userStore.registerUser(String(username), String(password), String(cardCode));
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json({ ok: true, data: result.user });
    });

    // 用户续费（登录后使用时间卡/额度卡续期）
    app.post('/api/user/renew', authRequired, (req: Request, res: Response) => {
        const { cardCode } = req.body || {};
        const currentUser = (req as any).currentUser;
        const username = currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!cardCode) {
            return res.status(400).json({ ok: false, error: '请提供卡密' });
        }

        const result = userStore.renewUser(username, String(cardCode));
        if (!result.ok) {
            return res.status(400).json(result);
        }

        // 更新该用户所有会话中的信息
        for (const [token, user] of ctx.tokenUserMap.entries()) {
            if (user.username === username) {
                user.card = result.card;
                user.accountLimit = result.accountLimit;
                ctx.tokenUserMap.set(token, user);
            }
        }

        res.json({ ok: true, data: { card: result.card, accountLimit: result.accountLimit, cardType: result.cardType } });
    });

    // 修改密码（当前登录用户）
    app.post('/api/user/change-password', authRequired, (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        const currentUser = (req as any).currentUser;
        const username = currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }

        const result = userStore.changePassword(username, String(oldPassword), String(newPassword));
        if (result.ok) {
            // 密码修改后强制重新登录（当前用户的所有会话）
            for (const [token, user] of ctx.tokenUserMap.entries()) {
                if (user.username === username) {
                    ctx.tokens.delete(token);
                    ctx.tokenUserMap.delete(token);
                }
            }
        }
        res.json(result);
    });

    // API 鉴权闸门（登录/注册/游戏版本等公开接口除外）：
    // 1) 校验 token 并解析当前用户；2) 请求携带 x-account-id 时校验账号归属，
    // 普通用户无法通过任何业务接口触达他人账号。
    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path === '/login' || req.path === '/register'
            || req.path === '/card-claim/status' || req.path === '/card-claim/claim'
            || req.path === '/game-version') return next();
        return authRequired(req, res, () => {
            const headerAccountRef = String(req.headers['x-account-id'] || '').trim();
            if (headerAccountRef) {
                const headerAccountId = resolveAccId(ctx, headerAccountRef);
                if (headerAccountId && !ensureAccountAccess(ctx, req as any, res, headerAccountId)) return;
            }
            next();
        });
    });

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        const { clientVersion, wxClientVersion } = getRuntimeConfig();
        res.json({ ok: true, clientVersion, wxClientVersion, botVersion: version });
    });

    app.get('/api/auth/validate', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { valid: true } });
    });

    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);

            // 检查账号归属权限
            if (id && !checkAccountAccess(ctx, req as any, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({
                ok: true,
                data: {
                    runtime: getSchedulerRegistrySnapshot(),
                    worker: null,
                    workerError: 'DataProvider does not support scheduler status',
                },
            });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) {
            ctx.tokens.delete(token);
            ctx.tokenUserMap.delete(token);
            if (ctx.io) {
                for (const socket of ctx.io.sockets.sockets.values()) {
                    if (String((socket.data as any).adminToken || '') === String(token)) socket.disconnect(true);
                }
            }
        }
        res.json({ ok: true });
    });

    // 当前登录用户信息
    app.get('/api/user/me', authRequired, (req: Request, res: Response) => {
        const user = (req as any).currentUser;
        if (!user) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }
        res.json({
            ok: true,
            data: {
                username: user.username,
                role: user.role,
                card: user.card || null,
                accountLimit: user.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT,
            },
        });
    });
}

module.exports = { mountAuthRoutes };
