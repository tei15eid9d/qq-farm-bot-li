<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BrandMark from '@/components/ui/BrandMark.vue'
import { useUserStore } from '@/stores/user'

declare const __APP_VERSION__: string

const userStore = useUserStore()
const appVersion = __APP_VERSION__
const gameVersion = ref('')
const wxGameVersion = ref('')

// 登录 / 注册模式切换
const isLogin = ref(true)
const cardCode = ref('')
const showPasswordStrength = ref(false)

// 免费领卡
const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)
const showClaimModal = ref(false)
const claimModalContent = ref({
  success: true,
  title: '',
  message: '',
  cardCode: '',
  days: 0,
})

const username = ref('')
const password = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)

const passwordStrength = computed(() => {
  const pwd = password.value
  if (!pwd)
    return { score: 0, level: '', color: '', valid: false }

  let score = 0
  if (pwd.length >= 6)
    score++
  if (pwd.length >= 10)
    score++

  let typeCount = 0
  if (/[a-z]/.test(pwd))
    typeCount++
  if (/[A-Z]/.test(pwd))
    typeCount++
  if (/[0-9]/.test(pwd))
    typeCount++
  if (/[^a-zA-Z0-9]/.test(pwd))
    typeCount++

  if (typeCount >= 2)
    score += 2
  if (typeCount >= 3)
    score++
  if (typeCount >= 4)
    score++

  const commonPasswords = ['password', '123456', 'qwerty', 'abc123', '111111']
  if (commonPasswords.some(p => pwd.toLowerCase().includes(p)))
    score = Math.max(0, score - 2)

  const level = score <= 2 ? '弱' : score <= 4 ? '中' : score <= 6 ? '强' : '非常强'
  const color = score <= 2 ? 'var(--ui-danger)' : score <= 4 ? '#f0a020' : score <= 6 ? 'var(--ui-primary)' : '#2f9e44'
  const valid = pwd.length >= 6 && typeCount >= 2

  return { score, level, color, valid }
})

const usernameValid = computed(() => {
  const name = username.value
  if (!name)
    return { valid: false, message: '' }
  if (name.length < 3)
    return { valid: false, message: '用户名至少3位' }
  if (name.length > 32)
    return { valid: false, message: '用户名最多32位' }
  if (!/^\w+$/.test(name))
    return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

watch(password, () => {
  if (!isLogin.value && password.value)
    showPasswordStrength.value = true
})

function validateForm(): boolean {
  if (!username.value) {
    error.value = '请输入用户名'
    return false
  }
  if (!usernameValid.value.valid) {
    error.value = usernameValid.value.message
    return false
  }
  if (!password.value) {
    error.value = '请输入密码'
    return false
  }
  if (!isLogin.value) {
    if (password.value.length < 6) {
      error.value = '密码长度至少6位'
      return false
    }
    if (!passwordStrength.value.valid) {
      error.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
      return false
    }
    if (!cardCode.value) {
      error.value = '请输入卡密'
      return false
    }
  }
  return true
}

async function handleSubmit() {
  if (!validateForm())
    return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    if (isLogin.value) {
      const result = await userStore.login(username.value, password.value)
      if (result.ok) {
        if (result.data?.mustChangePassword)
          success.value = '登录成功，请修改默认密码'
        setTimeout(() => {
          window.location.href = '/'
        }, 500)
      }
      else if (result.errorType === 'rate_limit') {
        error.value = result.error || '请求过于频繁，请稍后重试'
        if (result.remainingMs)
          rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000)
      }
      else if (result.errorType === 'locked') {
        error.value = result.error || '账户已被锁定'
        if (result.remainingMs)
          lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60)
      }
      else {
        error.value = result.error || '登录失败'
      }
    }
    else {
      const result = await userStore.register(username.value, password.value, cardCode.value)
      if (result.ok) {
        success.value = '注册成功，请登录'
        isLogin.value = true
        cardCode.value = ''
        password.value = ''
        showPasswordStrength.value = false
      }
      else {
        error.value = result.error || '注册失败'
      }
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') {
      error.value = getApiErrorMessage(data, '请求过于频繁')
      if (data.remainingMs)
        rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000)
    }
    else if (data?.errorType === 'locked') {
      error.value = getApiErrorMessage(data, '账户已被锁定')
      if (data.remainingMs)
        lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60)
    }
    else {
      error.value = getApiErrorMessage(e, '操作异常')
    }
  }
  finally {
    loading.value = false
  }
}

function toggleMode() {
  isLogin.value = !isLogin.value
  error.value = ''
  success.value = ''
  showPasswordStrength.value = false
  lockoutRemaining.value = 0
  rateLimitRemaining.value = 0
}

async function checkCardClaimStatus() {
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok)
      cardClaimEnabled.value = res.data.enabled === true
  }
  catch (e) {
    console.error('检查卡密领取状态失败:', e)
  }
}

async function claimFreeCard() {
  if (cardClaimLoading.value)
    return

  cardClaimLoading.value = true
  error.value = ''

  try {
    const res = await api.post('/api/card-claim/claim')

    if (res.data.ok) {
      cardCode.value = res.data.cardCode
      claimModalContent.value = {
        success: true,
        title: '领取成功',
        message: `成功领取 ${res.data.days} 天卡密！`,
        cardCode: res.data.cardCode,
        days: res.data.days,
      }
      showClaimModal.value = true
    }
    else {
      claimModalContent.value = {
        success: false,
        title: '领取失败',
        message: res.data.error || '领取失败，请稍后重试',
        cardCode: '',
        days: 0,
      }
      showClaimModal.value = true
    }
  }
  catch (e: any) {
    const data = e.response?.data
    claimModalContent.value = {
      success: false,
      title: '领取失败',
      message: data?.error || e.message || '领取失败',
      cardCode: '',
      days: 0,
    }
    showClaimModal.value = true
  }
  finally {
    cardClaimLoading.value = false
  }
}

function closeClaimModal() {
  showClaimModal.value = false
}

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok) {
      gameVersion.value = res.data.clientVersion
      wxGameVersion.value = res.data.wxClientVersion || ''
    }
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}

onMounted(() => {
  fetchGameVersion()
  checkCardClaimStatus()
})
</script>

<template>
  <main class="login-container">
    <section class="login-card">
      <header class="logo-area">
        <BrandMark class="logo-icon" :size="58" />
        <div>
          <span class="logo-kicker">QQ FARM</span>
          <h1 class="logo-title">
            QQ农场智能助手
          </h1>
          <p class="logo-subtitle">
            {{ isLogin ? '登录您的农场账户' : '使用卡密注册新账户' }}
          </p>
        </div>
      </header>

      <form class="form-area" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label class="form-label" for="username">
            <span class="i-carbon-user" />
            用户名
          </label>
          <BaseInput
            id="username"
            v-model="username"
            type="text"
            :placeholder="isLogin ? '请输入用户名' : '请输入用户名（3-32位字母数字下划线）'"
            autocomplete="username"
            required
          />
          <p v-if="username && !usernameValid.valid" class="form-hint error">
            {{ usernameValid.message }}
          </p>
        </div>

        <div class="form-group">
          <label class="form-label" for="password">
            <span class="i-carbon-locked" />
            密码
          </label>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            :placeholder="isLogin ? '请输入密码' : '请设置密码（至少6位，含两种字符类型）'"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
            required
          />
          <div v-if="showPasswordStrength && password" class="password-strength">
            <div class="strength-bar">
              <div
                class="strength-fill"
                :style="{ width: `${Math.min(passwordStrength.score * 12.5, 100)}%`, backgroundColor: passwordStrength.color }"
              />
            </div>
            <span class="strength-text" :style="{ color: passwordStrength.color }">
              {{ passwordStrength.level }}
            </span>
          </div>
        </div>

        <div v-if="!isLogin" class="form-group">
          <label class="form-label" for="cardCode">
            <span class="i-carbon-ticket" />
            卡密
          </label>
          <div v-if="cardClaimEnabled" class="claim-btn-wrap">
            <button
              type="button"
              class="claim-card-btn"
              :disabled="cardClaimLoading"
              @click="claimFreeCard"
            >
              <span v-if="cardClaimLoading" class="i-svg-spinners-90-ring-with-bg" />
              <span v-else>🎁 免费领取卡密</span>
            </button>
          </div>
          <BaseInput
            id="cardCode"
            v-model="cardCode"
            type="text"
            placeholder="请输入卡密"
            required
          />
        </div>

        <div v-if="error" class="message error-message" role="alert">
          <span class="i-carbon-warning-alt" />
          <div>
            {{ error }}
            <span v-if="lockoutRemaining > 0">（{{ lockoutRemaining }} 分钟后解锁）</span>
            <span v-if="rateLimitRemaining > 0">（{{ rateLimitRemaining }} 秒后可重试）</span>
          </div>
        </div>
        <div v-if="success" class="message success-message" role="status">
          <span class="i-carbon-checkmark-filled" />
          {{ success }}
        </div>

        <BaseButton type="submit" variant="primary" block :loading="loading" class="submit-btn">
          <span v-if="!loading" class="inline-flex items-center gap-2">
            <span :class="isLogin ? 'i-carbon-login' : 'i-carbon-user-follow'" />
            {{ isLogin ? '登录' : '注册' }}
          </span>
        </BaseButton>
      </form>

      <div class="switch-area">
        <button type="button" class="switch-btn" @click="toggleMode">
          {{ isLogin ? '没有账号？使用卡密注册' : '已有账号？返回登录' }}
        </button>
      </div>

      <footer class="card-footer">
        <div class="footer-info">
          <span>Web v{{ appVersion }}</span>
          <span v-if="gameVersion">QQ {{ gameVersion }}</span>
          <span v-if="wxGameVersion">微信 {{ wxGameVersion }}</span>
        </div>
        <a href="https://github.com/liyangpengs/qq-farm-bot" target="_blank" rel="noopener noreferrer" class="github-link" aria-label="GitHub">
          <span class="i-carbon-logo-github" />
        </a>
      </footer>
    </section>

    <!-- 卡密领取结果弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showClaimModal"
          class="claim-modal-overlay"
          @click.self="closeClaimModal"
        >
          <div class="claim-modal">
            <div class="claim-modal-header">
              <span class="claim-modal-icon">{{ claimModalContent.success ? '🎉' : '⚠️' }}</span>
              <h3 class="claim-modal-title">
                {{ claimModalContent.title }}
              </h3>
            </div>
            <div class="claim-modal-body">
              <p class="claim-modal-message">
                {{ claimModalContent.message }}
              </p>
              <div v-if="claimModalContent.success && claimModalContent.cardCode" class="claim-modal-card-info">
                <div class="card-code-label">
                  卡密已自动填入
                </div>
                <div class="card-code-value">
                  {{ claimModalContent.cardCode }}
                </div>
              </div>
            </div>
            <div class="claim-modal-footer">
              <button class="claim-modal-btn" @click="closeClaimModal">
                {{ claimModalContent.success ? '开始注册' : '我知道了' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.login-container {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 100dvh;
  place-items: center;
  overflow: hidden;
  padding: 28px 18px;
  color: var(--ui-ink);
  background-color: var(--ui-bg);
  background-image:
    linear-gradient(rgba(67, 141, 99, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(67, 141, 99, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
}

.login-container::before {
  position: absolute;
  inset: 8% 7%;
  border: 1px solid rgba(67, 141, 99, 0.08);
  border-radius: 36px;
  background: color-mix(in srgb, var(--ui-surface-strong) 22%, transparent);
  content: '';
}

.login-card {
  position: relative;
  z-index: 1;
  width: min(430px, 100%);
  padding: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--ui-bg) 82%, transparent);
  box-shadow:
    0 28px 76px rgba(55, 75, 61, 0.16),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(24px) saturate(135%);
  backdrop-filter: blur(24px) saturate(135%);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--ui-border);
}

.logo-icon {
  flex: none;
  filter: drop-shadow(0 8px 18px rgba(45, 122, 83, 0.24));
}

.logo-kicker {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 700;
}

.logo-title {
  margin: 2px 0 0;
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: 0;
}

.logo-subtitle {
  margin: 5px 0 0;
  color: var(--ui-muted);
  font-size: 12px;
}

.form-area {
  display: flex;
  flex-direction: column;
  gap: 17px;
  padding-top: 24px;
}

.form-group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.form-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-ink);
  font-size: 13px;
  font-weight: 600;
}

.form-label > span {
  color: var(--ui-primary);
}

.login-card :deep(.base-input) {
  height: 42px;
  border-color: var(--ui-border);
  border-radius: 10px;
  color: var(--ui-ink);
  background: color-mix(in srgb, var(--ui-surface-strong) 70%, transparent);
}

.login-card :deep(.base-input:focus) {
  border-color: rgba(67, 141, 99, 0.55);
  box-shadow: 0 0 0 3px rgba(67, 141, 99, 0.1);
}

.form-hint {
  margin: 0;
  color: var(--ui-danger);
  font-size: 11px;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.error-message {
  border-color: rgba(201, 95, 102, 0.18);
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.success-message {
  border-color: rgba(67, 141, 99, 0.18);
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.submit-btn {
  margin-top: 2px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22px;
  padding-top: 17px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-subtle);
  font-size: 10px;
}

.footer-info {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.github-link {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  color: var(--ui-muted);
  text-decoration: none;
}

.github-link:hover {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

/* 密码强度 */
.password-strength {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.strength-bar {
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--ui-border);
}

.strength-fill {
  height: 100%;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.strength-text {
  min-width: 44px;
  font-size: 11px;
  font-weight: 500;
}

/* 免费领卡 */
.claim-btn-wrap {
  margin-bottom: 2px;
}

.claim-card-btn {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 14px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--ui-primary) 0%, color-mix(in srgb, var(--ui-primary) 75%, #000) 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ui-primary) 25%, transparent);
}

.claim-card-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ui-primary) 35%, transparent);
}

.claim-card-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* 模式切换 */
.switch-area {
  margin-top: 18px;
  text-align: center;
}

.switch-btn {
  padding: 7px 14px;
  border: none;
  border-radius: 20px;
  background: none;
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s ease;
}

.switch-btn:hover {
  background: var(--ui-primary-soft);
}

/* 卡密领取弹窗 */
.claim-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.claim-modal {
  width: 100%;
  max-width: 340px;
  overflow: hidden;
  border-radius: 18px;
  background: var(--ui-bg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: modalSlideIn 0.3s ease;
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.claim-modal-header {
  padding: 22px 20px 14px;
  background: linear-gradient(135deg, var(--ui-primary-soft) 0%, color-mix(in srgb, var(--ui-primary) 15%, var(--ui-bg)) 100%);
  text-align: center;
}

.claim-modal-icon {
  display: block;
  margin-bottom: 6px;
  font-size: 2.6rem;
}

.claim-modal-title {
  margin: 0;
  color: var(--ui-primary);
  font-size: 1.15rem;
  font-weight: 700;
}

.claim-modal-body {
  padding: 18px;
  text-align: center;
}

.claim-modal-message {
  margin: 0 0 14px;
  color: var(--ui-ink);
  font-size: 14px;
  line-height: 1.5;
}

.claim-modal-card-info {
  margin-top: 8px;
  padding: 14px;
  border-radius: 12px;
  background: var(--ui-primary-soft);
}

.card-code-label {
  margin-bottom: 8px;
  color: var(--ui-muted);
  font-size: 11px;
}

.card-code-value {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--ui-bg);
  color: var(--ui-primary);
  font-family: 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
}

.claim-modal-footer {
  padding: 0 18px 18px;
}

.claim-modal-btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--ui-primary) 0%, color-mix(in srgb, var(--ui-primary) 75%, #000) 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.25s ease;
}

.claim-modal-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px color-mix(in srgb, var(--ui-primary) 40%, transparent);
}

/* 弹窗过渡动画 */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .claim-modal,
.modal-leave-to .claim-modal {
  transform: translateY(-20px) scale(0.95);
}

@media (max-width: 480px) {
  .login-container {
    align-items: center;
    padding: 16px 12px;
  }

  .login-container::before {
    inset: 4%;
    border-radius: 24px;
  }

  .login-card {
    padding: 24px 20px;
    border-radius: 16px;
  }

  .logo-icon {
    width: 52px;
    height: 52px;
  }

  .logo-title {
    font-size: 19px;
  }
}
</style>
