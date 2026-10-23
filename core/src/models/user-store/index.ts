export {};
/**
 * 用户系统统一出口。
 * - users.ts：用户与卡密存储（加载时自动初始化默认管理员 / 迁移旧版 admin.json）
 * - auth.ts：登录审计日志
 * - card-claim.ts：登录页免费领卡
 */
const auth = require('./auth');
const users = require('./users');
const cardClaim = require('./card-claim');

// Initialize default admin on load
users.initDefaultAdmin();

module.exports = {
    // Auth / 用户
    validateUser: users.validateUser,
    registerUser: users.registerUser,
    renewUser: users.renewUser,
    getAllUsers: users.getAllUsers,
    updateUser: users.updateUser,
    editUser: users.editUser,
    getAllCards: users.getAllCards,
    createCard: users.createCard,
    createCardsBatch: users.createCardsBatch,
    updateCard: users.updateCard,
    deleteCard: users.deleteCard,
    deleteCardsBatch: users.deleteCardsBatch,
    deleteUser: users.deleteUser,
    changePassword: users.changePassword,
    saveWxLoginConfig: users.saveWxLoginConfig,
    getWxLoginConfig: users.getWxLoginConfig,
    getUserAccountLimit: users.getUserAccountLimit,
    canAddAccount: users.canAddAccount,
    DEFAULT_ACCOUNT_LIMIT: users.DEFAULT_ACCOUNT_LIMIT,

    // 登录日志
    addLoginLog: auth.addLoginLog,
    getLoginLogs: auth.getLoginLogs,
    clearLoginLogs: auth.clearLoginLogs,

    // 卡密领取
    getCardClaimStatus: cardClaim.getCardClaimStatus,
    setCardClaimStatus: cardClaim.setCardClaimStatus,
    claimCardByUA: cardClaim.claimCardByUA,
    getCardClaimRecords: cardClaim.getCardClaimRecords,
    clearExpiredClaimRecords: cardClaim.clearExpiredClaimRecords,
};
