export {};
/**
 * 用户系统 - 登录日志
 * 密码哈希 / 速率限制 / 锁定策略统一复用 models/auth-security（PBKDF2），
 * 这里只负责登录审计日志的读写。
 */
const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');

const LOGIN_LOGS_FILE: string = getDataFile('login-logs.json');

interface LoginLogEntry {
    event: string;
    username: string;
    errorType: string | null;
    ip: string;
    userAgent: string;
    time: number;
}

const MAX_LOG_ENTRIES = 500;

let logs: LoginLogEntry[] = [];

function loadLoginLogs(): void {
    ensureDataDir();
    try {
        if (fs.existsSync(LOGIN_LOGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(LOGIN_LOGS_FILE, 'utf8'));
            logs = Array.isArray(data.logs) ? data.logs : [];
        } else {
            logs = [];
            saveLoginLogs();
        }
    } catch {
        logs = [];
    }
}

function saveLoginLogs(): void {
    ensureDataDir();
    try {
        fs.writeFileSync(LOGIN_LOGS_FILE, JSON.stringify({ logs }, null, 2), 'utf8');
    } catch {
        // ignore write failures
    }
}

function addLoginLog(entry: Record<string, any>): LoginLogEntry {
    loadLoginLogs();
    const record: LoginLogEntry = {
        event: String(entry.event || 'unknown'),
        username: String(entry.username || ''),
        errorType: entry.errorType === undefined ? null : entry.errorType,
        ip: String(entry.ip || 'unknown'),
        userAgent: String(entry.userAgent || 'unknown'),
        time: Date.now(),
    };
    logs.unshift(record);
    if (logs.length > MAX_LOG_ENTRIES) logs = logs.slice(0, MAX_LOG_ENTRIES);
    saveLoginLogs();
    return record;
}

function getLoginLogs(limit: number = 100, offset: number = 0): { logs: LoginLogEntry[]; total: number } {
    loadLoginLogs();
    const start = Math.max(0, Number(offset) || 0);
    const count = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return {
        logs: logs.slice(start, start + count),
        total: logs.length,
    };
}

function clearLoginLogs(): { ok: boolean } {
    logs = [];
    saveLoginLogs();
    return { ok: true };
}

loadLoginLogs();

module.exports = {
    loadLoginLogs,
    saveLoginLogs,
    addLoginLog,
    getLoginLogs,
    clearLoginLogs,
};
