import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 管理员路由：公告、卡密管理、卡密领取开关、用户管理、登录日志。
 * 全部要求 admin 角色（公告读取除外）。
 */
const store = require('../../models/store');
const userStore = require('../../models/user-store');

const {
    createAuthRequired,
    adminRequired,
} = require('./middleware');

function mountAdminRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    // ============ 公告 ============
    // 获取公告（所有登录用户可读）
    app.get('/api/announcement', authRequired, (req: Request, res: Response) => {
        try {
            const currentUser = (req as any).currentUser;
            const announcement = store.getAnnouncement();
            const shouldShow = store.shouldShowAnnouncement(currentUser?.username);
            res.json({
                ok: true,
                data: {
                    ...announcement,
                    shouldShow,
                },
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 标记公告已读
    app.post('/api/announcement/read', authRequired, (req: Request, res: Response) => {
        try {
            const currentUser = (req as any).currentUser;
            if (currentUser?.username) {
                store.markAnnouncementRead(currentUser.username);
            }
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 设置公告（仅管理员）
    app.post('/api/admin/announcement', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { content, showOnce } = req.body || {};
            const currentUser = (req as any).currentUser;
            const announcement = store.setAnnouncement(content, showOnce !== false, currentUser?.username || '');
            res.json({ ok: true, data: announcement });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 卡密管理（仅管理员） ============

    // 获取所有卡密
    app.get('/api/admin/cards', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const cards = userStore.getAllCards();
            res.json({ ok: true, data: cards });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 创建卡密（支持批量）
    app.post('/api/admin/cards', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { description, days, count, type } = req.body || {};
            if (!description || days === undefined) {
                return res.status(400).json({ ok: false, error: '请提供描述和天数' });
            }

            const cardType = type === 'quota' ? 'quota' : 'time';

            if (count && Number.parseInt(count, 10) > 1) {
                const cards = userStore.createCardsBatch(String(description), days, count, cardType);
                return res.json({ ok: true, data: cards, batch: true, count: cards.length });
            }

            const card = userStore.createCard(String(description), days, cardType);
            res.json({ ok: true, data: card });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 批量删除卡密（必须放在 /:code 路由之前）
    app.post('/api/admin/cards/batch-delete', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { codes } = req.body || {};
            if (!Array.isArray(codes) || codes.length === 0) {
                return res.status(400).json({ ok: false, error: '请提供要删除的卡密列表' });
            }
            const result = userStore.deleteCardsBatch(codes);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新卡密
    app.post('/api/admin/cards/:code', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const updates = req.body || {};
            const card = userStore.updateCard(code, updates);
            if (!card) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            res.json({ ok: true, data: card });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除卡密
    app.delete('/api/admin/cards/:code', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const ok = userStore.deleteCard(code);
            if (!ok) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 卡密领取（登录页免费领卡） ============
    // 获取领取功能状态（公开，登录页用）
    app.get('/api/card-claim/status', (_req: Request, res: Response) => {
        try {
            const status = userStore.getCardClaimStatus();
            res.json({ ok: true, enabled: status.enabled });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 开关领取功能（仅管理员）
    app.post('/api/admin/card-claim/status', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { enabled } = req.body;
            const status = userStore.setCardClaimStatus(enabled === true);
            res.json({ ok: true, enabled: status.enabled });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 用户领取卡密（按 User-Agent 限流，公开接口）
    app.post('/api/card-claim/claim', (req: Request, res: Response) => {
        try {
            const ua = String(req.headers['user-agent'] || '');
            const username = req.body?.username || null;

            userStore.clearExpiredClaimRecords();

            const result = userStore.claimCardByUA(ua, username);

            if (!result.ok) {
                const response: any = { ok: false, error: result.error };
                if (result.remainingMs) {
                    response.remainingMs = result.remainingMs;
                }
                return res.status(400).json(response);
            }

            res.json({
                ok: true,
                cardCode: result.cardCode,
                days: result.days,
                description: result.description,
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 领取记录（仅管理员）
    app.get('/api/admin/card-claim/records', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const records = userStore.getCardClaimRecords();
            res.json({ ok: true, data: records });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 用户管理（仅管理员） ============
    // 获取所有用户
    app.get('/api/admin/users', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const users = userStore.getAllUsers();
            res.json({ ok: true, data: users });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新用户（封禁/解禁、改到期时间）
    app.post('/api/admin/users/:username', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const updates = req.body || {};
            const user = userStore.updateUser(username, updates);
            if (!user) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            // 同步在线会话：封禁/解禁立即生效，无需等待定期清理
            for (const [token, sessionUser] of ctx.tokenUserMap.entries()) {
                if (sessionUser.username === username) {
                    sessionUser.card = user.card || null;
                    sessionUser.accountLimit = user.accountLimit;
                    ctx.tokenUserMap.set(token, sessionUser);
                }
            }
            res.json({ ok: true, data: user });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 编辑用户（改名、重置密码、账号上限、续期）
    app.post('/api/admin/users/:username/edit', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const { newUsername, password, accountLimit, expiresAt, isPermanent } = req.body || {};

            const result = userStore.editUser(username, {
                newUsername,
                password,
                accountLimit,
                expiresAt,
                isPermanent,
            });

            if (!result.ok) {
                return res.status(400).json(result);
            }

            // 同步更新该用户的在线会话
            for (const [token, user] of ctx.tokenUserMap.entries()) {
                if (user.username === username || user.username === newUsername) {
                    user.username = result.user.username;
                    user.card = result.user.card;
                    user.accountLimit = result.user.accountLimit;
                    ctx.tokenUserMap.set(token, user);
                }
            }

            res.json({ ok: true, data: result.user });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除用户（级联删除其账号与在线会话）
    app.delete('/api/admin/users/:username', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const currentUser = (req as any).currentUser;

            // 不能删除自己
            if (currentUser && currentUser.username === username) {
                return res.status(400).json({ ok: false, error: '不能删除自己的账号' });
            }

            const result = userStore.deleteUser(username, true);
            if (!result.ok) {
                return res.status(400).json(result);
            }

            // 停掉并删除该用户名下的全部账号
            try {
                const owned = store.getAccountsByUser(username);
                for (const account of owned.accounts) {
                    if (ctx.provider && typeof ctx.provider.stopAccount === 'function') {
                        ctx.provider.stopAccount(String(account.id));
                    }
                }
                const deleted = store.deleteAccountsByUser(username);
                if (deleted.deletedCount > 0 && ctx.provider && ctx.provider.addAccountLog) {
                    ctx.provider.addAccountLog('delete', `删除用户 ${username}，级联删除 ${deleted.deletedCount} 个账号`);
                }
            } catch (e: any) {
                console.error('[用户管理] 级联删除账号失败:', e.message);
            }

            // 强制下线该用户的所有会话
            for (const [token, user] of ctx.tokenUserMap.entries()) {
                if (user.username === username) {
                    ctx.tokens.delete(token);
                    ctx.tokenUserMap.delete(token);
                    if (ctx.io) {
                        for (const socket of ctx.io.sockets.sockets.values()) {
                            if (String((socket.data as any).adminToken || '') === String(token)) {
                                socket.disconnect(true);
                            }
                        }
                    }
                }
            }

            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员为用户续费
    app.post('/api/admin/users/:username/renew', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const { cardCode } = req.body || {};

            if (!cardCode) {
                return res.status(400).json({ ok: false, error: '请提供卡密' });
            }

            const result = userStore.renewUser(username, String(cardCode));
            if (!result.ok) {
                return res.status(400).json(result);
            }

            // 更新该用户在线会话中的卡密信息
            for (const [token, user] of ctx.tokenUserMap.entries()) {
                if (user.username === username) {
                    user.card = result.card;
                    user.accountLimit = result.accountLimit;
                    ctx.tokenUserMap.set(token, user);
                }
            }

            res.json({ ok: true, data: { card: result.card, accountLimit: result.accountLimit, cardType: result.cardType } });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 登录日志（仅管理员） ============
    app.get('/api/admin/login-logs', authRequired, adminRequired, (req: Request, res: Response) => {
        try {
            const limit = Math.min(Math.max(Number.parseInt(req.query.limit as string) || 100, 1), 500);
            const offset = Math.max(Number.parseInt(req.query.offset as string) || 0, 0);
            const result = userStore.getLoginLogs(limit, offset);
            res.json({ ok: true, data: result });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/admin/login-logs', authRequired, adminRequired, (_req: Request, res: Response) => {
        try {
            const result = userStore.clearLoginLogs();
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
}

module.exports = { mountAdminRoutes };
