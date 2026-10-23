import type { Application } from 'express';
import type { Server } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';
export {};

/**
 * AdminContext factory
 * Creates and holds all shared state for the admin server.
 */

export interface AdminContext {
    tokens: Set<string>;
    /** token -> 登录用户（{ username, role, card, accountLimit, ... }），多用户隔离的核心映射 */
    tokenUserMap: Map<string, any>;
    app: Application | null;
    server: Server | null;
    io: SocketIOServer | null;
    provider: any;
}

function createAdminContext(dataProvider: any): AdminContext {
    const tokens = new Set<string>();
    const tokenUserMap = new Map<string, any>();
    return {
        tokens,
        tokenUserMap,
        app: null,
        server: null,
        io: null,
        provider: dataProvider,
    };
}

module.exports = { createAdminContext };
