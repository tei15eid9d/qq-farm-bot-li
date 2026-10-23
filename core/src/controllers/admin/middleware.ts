import type { NextFunction, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * Admin middleware and helper functions.
 * 多用户模型：
 * - ctx.tokens + ctx.tokenUserMap：token -> 登录用户（admin / user）
 * - req.currentUser：当前登录用户，admin 拥有全部权限，user 只能访问归属自己的账号
 */
const crypto = require('node:crypto');

const store = require('../../models/store');
const { normalizeAccountRef, resolveAccountId } = require('../../services/account-resolver');

interface AuthenticatedRequest extends Request {
    adminToken?: string;
    currentUser?: any;
}

function getClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return String(cfIp).trim();
    const realIp = req.headers['x-real-ip'];
    if (realIp) return String(realIp).trim();
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const first = String(forwarded).split(',').map(item => item.trim()).find(Boolean);
        if (first) return first;
    }
    const address = req.ip || (req as any).connection?.remoteAddress || req.socket?.remoteAddress;
    return String(address || 'unknown').replace(/^::ffff:/, '');
}

const issueToken = (): string => crypto.randomBytes(24).toString('hex');

/** 历史数据兼容：没有 username 归属字段的账号视为 admin 所有。 */
function accountOwner(account: any): string {
    return String(account?.username || '') || 'admin';
}

function createAuthRequired(ctx: AdminContext) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const token = String(req.headers['x-admin-token'] || '');
        if (!token || !ctx.tokens.has(token)) {
            res.status(401).json({ ok: false, error: 'Unauthorized' });
            return;
        }
        req.adminToken = token;
        req.currentUser = ctx.tokenUserMap.get(token) || null;

        // 管理员不检查封禁和过期
        if (req.currentUser && req.currentUser.role !== 'admin') {
            // 检查用户状态（每次请求都检查）
            if (req.currentUser.card) {
                // 检查是否被封禁
                if (req.currentUser.card.enabled === false) {
                    console.log('[请求拒绝] 用户已被封禁:', req.currentUser.username);
                    ctx.tokens.delete(token);
                    ctx.tokenUserMap.delete(token);
                    res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                    return;
                }

                // 检查是否过期
                if (req.currentUser.card.expiresAt) {
                    const now = Date.now();
                    if (req.currentUser.card.expiresAt < now) {
                        console.log('[请求拒绝] 用户已过期:', req.currentUser.username);
                        ctx.tokens.delete(token);
                        ctx.tokenUserMap.delete(token);
                        res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                        return;
                    }
                }
            }
        }

        next();
    };
}

const adminRequired = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.currentUser || req.currentUser.role !== 'admin') {
        res.status(403).json({ ok: false, error: '需要管理员权限' });
        return;
    }
    next();
};

// 定期清理被封禁/过期的用户会话（由 admin 服务器定时调用）
function createCleanupExpiredUsers(ctx: AdminContext): () => void {
    return () => {
        const now = Date.now();
        const usersToCleanup: Array<{ token: string; username: string; reason: string }> = [];

        for (const [token, user] of ctx.tokenUserMap.entries()) {
            if (user.role === 'admin') continue; // 管理员不检查

            // 检查是否被封禁
            if (user.card && user.card.enabled === false) {
                console.log(`[自动检查] 用户 ${user.username} 已被封禁，执行清理...`);
                usersToCleanup.push({ token, username: user.username, reason: 'banned' });
                continue;
            }

            // 检查是否过期
            if (user.card && user.card.expiresAt && user.card.expiresAt < now) {
                console.log(`[自动检查] 用户 ${user.username} 已过期，执行清理...`);
                usersToCleanup.push({ token, username: user.username, reason: 'expired' });
            }
        }

        for (const { token, username, reason } of usersToCleanup) {
            ctx.tokens.delete(token);
            ctx.tokenUserMap.delete(token);
            // 断开相关 socket 连接
            if (ctx.io) {
                for (const socket of ctx.io.sockets.sockets.values()) {
                    if (String((socket.data as any).adminToken || '') === String(token)) {
                        socket.disconnect(true);
                    }
                }
            }
            console.log(`[自动清理] 用户 ${username} 已${reason === 'banned' ? '被封禁' : '过期'}，已强制下线`);
        }
    };
}

/**
 * 账号列表。username 为空（管理员）返回全部；
 * 普通用户只返回归属自己的账号。
 */
function getAccountList(ctx: AdminContext, username: string | null = null): any[] {
    try {
        if (ctx.provider && typeof ctx.provider.getAccounts === 'function') {
            const data = ctx.provider.getAccounts();
            if (Array.isArray(data?.accounts)) {
                const owner = String(username || '').trim();
                if (!owner) return data.accounts;
                return data.accounts.filter((a: any) => accountOwner(a) === owner);
            }
        }
    } catch {
        // Fall back to persistent storage.
    }
    const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
    let accounts: any[] = Array.isArray(data.accounts) ? data.accounts : [];
    const owner = String(username || '').trim();
    if (owner) {
        accounts = accounts.filter((a: any) => accountOwner(a) === owner);
    }
    return accounts;
}

function getAccountIds(ctx: AdminContext, username: string | null = null): string[] {
    return getAccountList(ctx, username).map((account: any) => String(account.id || '')).filter(Boolean);
}

// 检查用户是否有权访问指定账号
function checkAccountAccess(ctx: AdminContext, req: AuthenticatedRequest, accountId: string): boolean {
    const currentUser = req.currentUser;
    if (!currentUser) return false;
    // 管理员可以访问所有账号
    if (currentUser.role === 'admin') return true;
    // 普通用户只能访问自己的账号
    const accounts = getAccountList(ctx);
    const account = accounts.find((a: any) => a.id === accountId);
    if (!account) return false;
    return accountOwner(account) === currentUser.username;
}

/** 便捷助手：校验指定账号归属，无权时直接返回 403。 */
function ensureAccountAccess(ctx: AdminContext, req: AuthenticatedRequest, res: Response, accountId: string): boolean {
    if (!accountId) return true;
    if (checkAccountAccess(ctx, req, accountId)) return true;
    res.status(403).json({ ok: false, error: '无权访问此账号' });
    return false;
}

// 获取当前用户可访问的账号ID列表
function getAccessibleAccountIds(ctx: AdminContext, req: AuthenticatedRequest): string[] {
    const currentUser = req.currentUser;
    if (!currentUser) return [];
    // 管理员可以访问所有账号
    if (currentUser.role === 'admin') {
        return getAccountIds(ctx);
    }
    // 普通用户只能访问自己的账号
    return getAccountIds(ctx, currentUser.username);
}

// 根据用户对象获取可访问的账号ID列表（用于WebSocket）
function getAccessibleAccountIdsForUser(ctx: AdminContext, user: any): string[] {
    if (!user) return [];
    // 管理员可以访问所有账号
    if (user.role === 'admin') {
        return getAccountIds(ctx);
    }
    // 普通用户只能访问自己的账号
    return getAccountIds(ctx, user.username);
}

const isSoftRuntimeError = (err: any): boolean => {
    const message = String(typeof err === 'string' ? err : err?.message || '');
    return message === '账号未运行' || message === 'API Timeout';
};

function isGatewayProtocolError(err: any): boolean {
    const message = String(typeof err === 'string' ? err : err?.message || '').trim();
    return String(err?.name || '') === 'GatewayError'
        || typeof err?.errorMessage === 'string'
        || typeof err?.error_message === 'string'
        || /^(?:[\w-]+\.)+[\w-]+(?:\s+.*?)?\bcode=\d+(?:\s|$)/.test(message);
}

function getProtocolErrorMessage(err: any): string {
    const direct = String(err?.errorMessage || err?.error_message || '').trim();
    if (direct) return direct;

    const message = String(typeof err === 'string' ? err : err?.message || '').trim();
    if (!isGatewayProtocolError(err)) return '';
    return message.match(/\bcode=\d+\b\s*(.*)$/)?.[1]?.trim() || '';
}

function handleApiError(res: Response, err: any): void {
    const protocolMessage = getProtocolErrorMessage(err);
    const payload: any = {
        ok: false,
        error: protocolMessage || (typeof err === 'string' ? err : err?.message) || 'Unknown error',
    };
    if (protocolMessage) payload.errorMessage = protocolMessage;
    const errorCode = Number(err?.code);
    if (Number.isFinite(errorCode) && errorCode !== 0) payload.errorCode = errorCode;
    if (isSoftRuntimeError(err) || isGatewayProtocolError(err)) {
        res.json(payload);
        return;
    }
    res.status(500).json(payload);
}

function resolveAccId(ctx: AdminContext, rawRef: any): string {
    const input = normalizeAccountRef(rawRef);
    if (!input) return '';
    if (ctx.provider && typeof ctx.provider.resolveAccountId === 'function') {
        const resolvedByProvider = normalizeAccountRef(ctx.provider.resolveAccountId(input));
        if (resolvedByProvider) return resolvedByProvider;
    }
    return resolveAccountId(getAccountList(ctx), input) || input;
}

function getAccId(ctx: AdminContext, req: Request): string {
    return resolveAccId(ctx, req.headers['x-account-id']);
}

function buildKnownFriendGidSettings(accountId: string): {
    knownFriendGids: any[];
    knownFriendGidSyncCooldownSec: number;
    friendsListCacheTtlSec: number;
} {
    return {
        knownFriendGids: store.getKnownFriendGids ? store.getKnownFriendGids(accountId) : [],
        knownFriendGidSyncCooldownSec: store.getKnownFriendGidSyncCooldownSec
            ? store.getKnownFriendGidSyncCooldownSec(accountId)
            : 600,
        friendsListCacheTtlSec: store.getFriendsListCacheTtlSec
            ? store.getFriendsListCacheTtlSec(accountId)
            : 60,
    };
}

module.exports = {
    getClientIp,
    issueToken,
    createAuthRequired,
    adminRequired,
    createCleanupExpiredUsers,
    getAccountList,
    getAccountIds,
    checkAccountAccess,
    ensureAccountAccess,
    getAccessibleAccountIds,
    getAccessibleAccountIdsForUser,
    isSoftRuntimeError,
    isGatewayProtocolError,
    getProtocolErrorMessage,
    handleApiError,
    resolveAccId,
    getAccId,
    buildKnownFriendGidSettings,
};
