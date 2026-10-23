<script setup lang="ts">
import type { Card, UserCard } from '@/stores/user'
import { NButton } from 'naive-ui/es/button'
import { NTab } from 'naive-ui/es/tabs'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import PageTabs from '@/components/PageTabs.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useMediaQuery } from '@/utils/use-media-query'

const userStore = useUserStore()
const toast = useToastStore()

// 窄屏（手机）下后台表格切换为卡片布局，避免列宽挤压导致文字竖排
const isMobile = useMediaQuery('(max-width: 639px)')

type AdminTab = 'card' | 'user' | 'log' | 'announcement'
const storedTab = localStorage.getItem('admin-active-tab')
const activeTab = ref<AdminTab>(
  (['card', 'user', 'log', 'announcement'] as AdminTab[]).includes(storedTab as AdminTab)
    ? storedTab as AdminTab
    : 'card',
)

watch(activeTab, (newTab) => {
  localStorage.setItem('admin-active-tab', newTab)
})

const tabs = [
  { key: 'card', label: '卡密', icon: 'i-carbon-ticket' },
  { key: 'user', label: '用户', icon: 'i-carbon-user-admin' },
  { key: 'log', label: '登录日志', icon: 'i-carbon-document' },
  { key: 'announcement', label: '公告', icon: 'i-carbon-notification' },
] as const

// ==================== 卡密管理 ====================
const cards = ref<Card[]>([])
const cardsLoading = ref(false)
const showCreateModal = ref(false)

const newCard = ref({
  description: '',
  days: 30,
  count: 1,
  type: 'time' as 'time' | 'quota',
})

const selectedCards = ref<Set<string>>(new Set())
const selectAll = ref(false)
const searchQuery = ref('')
const filterStatus = ref<'all' | 'used' | 'unused' | 'enabled' | 'disabled'>('all')
const cardTypeFilter = ref<'all' | 'time' | 'quota'>('all')

// 卡密领取开关
const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)

const unusedTimeCardsCount = computed(() => {
  return cards.value.filter(c => c.type === 'time' && !c.usedBy && c.enabled).length
})

const filteredCards = computed(() => {
  let result = cards.value

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(card =>
      card.code.toLowerCase().includes(query)
      || card.description.toLowerCase().includes(query)
      || (card.usedBy && card.usedBy.toLowerCase().includes(query)),
    )
  }

  switch (filterStatus.value) {
    case 'used':
      result = result.filter(card => card.usedBy)
      break
    case 'unused':
      result = result.filter(card => !card.usedBy)
      break
    case 'enabled':
      result = result.filter(card => card.enabled)
      break
    case 'disabled':
      result = result.filter(card => !card.enabled)
      break
  }

  if (cardTypeFilter.value !== 'all')
    result = result.filter(card => card.type === cardTypeFilter.value)

  return result
})

async function fetchCards() {
  cardsLoading.value = true
  try {
    const result = await userStore.getAllCards()
    if (result.ok)
      cards.value = result.data
    else
      toast.error(result.error || '获取卡密列表失败')
  }
  catch (e: any) {
    toast.error(e.message || '获取卡密列表失败')
  }
  finally {
    cardsLoading.value = false
  }
}

async function fetchCardClaimStatus() {
  cardClaimLoading.value = true
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok)
      cardClaimEnabled.value = res.data.enabled === true
  }
  catch (e: any) {
    console.error('获取卡密领取状态失败:', e)
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function toggleCardClaimStatus(value: boolean | undefined) {
  if (value === undefined)
    return
  cardClaimLoading.value = true
  try {
    const res = await api.post('/api/admin/card-claim/status', { enabled: value })
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled
      toast.success(value ? '卡密领取功能已开启' : '卡密领取功能已关闭')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
    cardClaimEnabled.value = !value
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function createCard() {
  if (!newCard.value.description.trim()) {
    toast.warning('请输入卡密描述')
    return
  }

  const count = Math.min(Math.max(Number.parseInt(String(newCard.value.count), 10) || 1, 1), 100)

  try {
    const result = await userStore.createCard(
      newCard.value.description.trim(),
      newCard.value.days,
      count > 1 ? count : undefined,
      newCard.value.type,
    )
    if (result.ok) {
      if (result.batch) {
        toast.success(`成功创建 ${result.count} 个卡密`)
        exportCardsToFile(result.data, `卡密批量导出_${newCard.value.description}_${formatDateForFile(Date.now())}.txt`)
      }
      else {
        toast.success('卡密创建成功')
      }
      showCreateModal.value = false
      newCard.value = { description: '', days: 30, count: 1, type: 'time' }
      await fetchCards()
    }
    else {
      toast.error(result.error || '创建卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '创建卡密失败')
  }
}

async function toggleCardStatus(card: Card) {
  try {
    const result = await userStore.updateCard(card.code, { enabled: !card.enabled })
    if (result.ok) {
      toast.success(card.enabled ? '卡密已禁用' : '卡密已启用')
      await fetchCards()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

// ============ 删除确认 ============
const confirmVisible = ref(false)
const confirmConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  loading: false,
})
let confirmAction: (() => Promise<void>) | null = null

function openConfirm(title: string, message: string, action: () => Promise<void>, type: 'primary' | 'danger' = 'danger') {
  confirmConfig.value = { title, message, type, loading: false }
  confirmAction = action
  confirmVisible.value = true
}

async function handleConfirm() {
  if (!confirmAction)
    return
  confirmConfig.value.loading = true
  try {
    await confirmAction()
    confirmVisible.value = false
  }
  catch (e: any) {
    toast.error(e?.message || '操作失败')
  }
  finally {
    confirmConfig.value.loading = false
  }
}

function handleConfirmCancel() {
  confirmVisible.value = false
}

function confirmDeleteCard(card: Card) {
  openConfirm('删除卡密', `确定要删除卡密 ${card.code} 吗？此操作不可恢复！`, async () => {
    const result = await userStore.deleteCard(card.code)
    if (result.ok) {
      toast.success('卡密删除成功')
      await fetchCards()
    }
    else {
      toast.error(result.error || '删除卡密失败')
    }
  })
}

async function deleteSelectedCards() {
  const selectedCodes = Array.from(selectedCards.value)
  if (selectedCodes.length === 0) {
    toast.warning('请先选择要删除的卡密')
    return
  }

  openConfirm('批量删除卡密', `确定要删除选中的 ${selectedCodes.length} 个卡密吗？此操作不可恢复！`, async () => {
    const result = await userStore.deleteCardsBatch(selectedCodes)
    if (result.ok) {
      toast.success(`成功删除 ${result.deletedCount} 个卡密`)
      if (result.notFoundCount > 0)
        toast.warning(`${result.notFoundCount} 个卡密未找到`)
      selectedCards.value.clear()
      selectAll.value = false
      await fetchCards()
    }
    else {
      toast.error(result.error || '批量删除卡密失败')
    }
  })
}

async function copyCode(code: string) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code)
      toast.success('卡密已复制到剪贴板')
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = code
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success('卡密已复制到剪贴板')
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

async function copySelectedCards() {
  const codes = Array.from(selectedCards.value)
  if (codes.length === 0)
    return

  try {
    const text = codes.join('\n')
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

function formatDate(timestamp: number | null) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatDateForFile(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}

function getCardTypeLabel(card: Card) {
  return card.type === 'quota' ? '额度' : '时间'
}

function getCardValueLabel(card: Card) {
  if (card.type === 'quota')
    return `+${card.days}额度`
  if (card.days === -1)
    return '永久'
  return `${card.days}天`
}

function exportCardsToFile(cardsToExport: Card[], filename?: string) {
  if (!cardsToExport || cardsToExport.length === 0) {
    toast.warning('没有可导出的卡密')
    return
  }

  const content = cardsToExport.map(card =>
    `卡密: ${card.code}\n描述: ${card.description}\n类型: ${getCardTypeLabel(card)}\n状态: ${card.enabled ? '启用' : '禁用'}\n${card.usedBy ? `使用者: ${card.usedBy}\n使用时间: ${formatDate(card.usedAt)}` : '未使用'}\n创建时间: ${formatDate(card.createdAt)}\n${'='.repeat(40)}`,
  ).join('\n\n')

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `卡密导出_${formatDateForFile(Date.now())}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success(`已导出 ${cardsToExport.length} 个卡密到文件`)
}

function toggleSelectAll() {
  if (selectAll.value) {
    filteredCards.value.forEach(card => selectedCards.value.add(card.code))
  }
  else {
    filteredCards.value.forEach(card => selectedCards.value.delete(card.code))
  }
}

function toggleSelectCard(code: string) {
  if (selectedCards.value.has(code)) {
    selectedCards.value.delete(code)
    selectAll.value = false
  }
  else {
    selectedCards.value.add(code)
    if (filteredCards.value.length > 0 && filteredCards.value.every(card => selectedCards.value.has(card.code)))
      selectAll.value = true
  }
}

// ==================== 用户管理 ====================
interface UserInfo {
  username: string
  role: string
  card: UserCard | null
  accountLimit: number
  createdAt: number
}

interface EditForm {
  newUsername: string
  password: string
  accountLimit: number
  expiresAt: string
  isPermanent: boolean
}

const users = ref<UserInfo[]>([])
const usersLoading = ref(false)
const showEditModal = ref(false)
const selectedUser = ref<UserInfo | null>(null)
const editForm = ref<EditForm>({
  newUsername: '',
  password: '',
  accountLimit: 2,
  expiresAt: '',
  isPermanent: false,
})
const editLoading = ref(false)

// 续期弹窗
const showRenewModal = ref(false)
const renewCardCode = ref('')
const renewLoading = ref(false)

const currentUsername = computed(() => userStore.username)

async function fetchUsers() {
  usersLoading.value = true
  try {
    const result = await userStore.getAllUsers()
    if (result.ok)
      users.value = result.data
    else
      toast.error(result.error || '获取用户列表失败')
  }
  catch (e: any) {
    toast.error(e.message || '获取用户列表失败')
  }
  finally {
    usersLoading.value = false
  }
}

function isUserBanned(user: UserInfo) {
  return user.role !== 'admin' && !!user.card && !user.card.enabled
}

function toggleUserStatus(user: UserInfo) {
  const willBan = !isUserBanned(user)
  openConfirm(
    willBan ? '封禁用户' : '解封用户',
    willBan ? `确定要封禁用户 ${user.username} 吗？封禁后其所有会话将立即失效。` : `确定要解封用户 ${user.username} 吗？`,
    async () => {
      const result = await userStore.updateUser(user.username, { enabled: !willBan })
      if (result.ok) {
        toast.success(willBan ? '用户已封禁' : '用户已解封')
        await fetchUsers()
      }
      else {
        toast.error(result.error || '操作失败')
      }
    },
  )
}

function confirmDeleteUser(user: UserInfo) {
  openConfirm('删除用户', `确定要删除用户 ${user.username} 吗？该用户名下的所有农场账号将被一并删除，此操作不可恢复！`, async () => {
    const result = await userStore.deleteUser(user.username)
    if (result.ok) {
      toast.success('用户删除成功')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '删除用户失败')
    }
  })
}

function openEditModal(user: UserInfo) {
  selectedUser.value = user
  editForm.value = {
    newUsername: user.username,
    password: '',
    accountLimit: user.accountLimit || 2,
    expiresAt: user.card?.expiresAt ? formatDateTimeLocal(user.card.expiresAt) : '',
    isPermanent: user.card?.days === -1,
  }
  showEditModal.value = true
}

function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function handleEdit() {
  if (!selectedUser.value)
    return

  if (editForm.value.password && editForm.value.password.length < 6) {
    toast.warning('密码长度至少6位')
    return
  }

  editLoading.value = true
  try {
    const expiresAtValue = editForm.value.isPermanent
      ? null
      : (editForm.value.expiresAt ? new Date(editForm.value.expiresAt).getTime() : null)

    const updateData: Record<string, any> = {
      accountLimit: editForm.value.accountLimit,
      expiresAt: expiresAtValue,
      isPermanent: editForm.value.isPermanent,
    }

    if (editForm.value.newUsername && editForm.value.newUsername !== selectedUser.value.username)
      updateData.newUsername = editForm.value.newUsername

    if (editForm.value.password)
      updateData.password = editForm.value.password

    const result = await userStore.editUser(selectedUser.value.username, updateData)

    if (result.ok) {
      toast.success('用户信息已更新')
      showEditModal.value = false
      await fetchUsers()
    }
    else {
      toast.error(result.error || '更新失败')
    }
  }
  catch (e: any) {
    toast.error(e?.message || '更新失败')
  }
  finally {
    editLoading.value = false
  }
}

function openRenewModal(user: UserInfo) {
  selectedUser.value = user
  renewCardCode.value = ''
  showRenewModal.value = true
}

async function handleRenew() {
  if (!selectedUser.value)
    return

  if (!renewCardCode.value.trim()) {
    toast.warning('请输入卡密')
    return
  }

  renewLoading.value = true
  try {
    const result = await userStore.renewUser(selectedUser.value.username, renewCardCode.value.trim())
    if (result.ok) {
      toast.success('续期成功')
      showRenewModal.value = false
      await fetchUsers()
    }
    else {
      toast.error(result.error || '续期失败')
    }
  }
  catch (e: any) {
    toast.error(e?.message || '续期失败')
  }
  finally {
    renewLoading.value = false
  }
}

function isUserExpired(user: UserInfo) {
  if (user.role === 'admin')
    return false
  if (!user.card?.expiresAt)
    return false
  return Date.now() > user.card.expiresAt
}

// ==================== 登录日志 ====================
interface LoginLog {
  id: string
  timestamp: number
  event: 'login_success' | 'login_failed'
  username: string
  errorType: string | null
  ip: string
  userAgent: string
}

const loginLogs = ref<LoginLog[]>([])
const loginLogsLoading = ref(false)
const loginLogsTotal = ref(0)

async function fetchLoginLogs() {
  loginLogsLoading.value = true
  try {
    const result = await userStore.getLoginLogs(100, 0)
    if (result.ok) {
      loginLogs.value = result.data.logs
      loginLogsTotal.value = result.data.total
    }
    else {
      toast.error(result.error || '获取登录日志失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取登录日志失败')
  }
  finally {
    loginLogsLoading.value = false
  }
}

function confirmClearLogs() {
  if (loginLogsTotal.value === 0) {
    toast.warning('暂无日志可清空')
    return
  }

  openConfirm('清空日志', '确定要清空全部登录日志吗？此操作不可恢复！', async () => {
    const result = await userStore.clearLoginLogs()
    if (result.ok) {
      toast.success('日志已清空')
      loginLogs.value = []
      loginLogsTotal.value = 0
    }
    else {
      toast.error(result.error || '清空失败')
    }
  })
}

function formatLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function getEventLabel(event: string): string {
  return event === 'login_success' ? '登录成功' : '登录失败'
}

function getEventClass(event: string): string {
  return event === 'login_success'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
    : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
}

function getErrorTypeLabel(errorType: string | null): string {
  if (!errorType)
    return '-'
  const labels: Record<string, string> = {
    rate_limit: '速率限制',
    locked: '账户锁定',
    invalid_credentials: '凭证错误',
  }
  return labels[errorType] || errorType
}

function parseBrowser(userAgent: string): string {
  if (!userAgent || userAgent === 'unknown')
    return '未知'

  if (userAgent.includes('Edg/')) {
    const match = userAgent.match(/Edg\/([\d.]+)/)
    return `Edge ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Chrome/')) {
    const match = userAgent.match(/Chrome\/([\d.]+)/)
    return `Chrome ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Firefox/')) {
    const match = userAgent.match(/Firefox\/([\d.]+)/)
    return `Firefox ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    const match = userAgent.match(/Version\/([\d.]+)/)
    return `Safari ${match ? match[1] : ''}`
  }
  if (userAgent.includes('MSIE') || userAgent.includes('Trident/'))
    return 'IE'

  return '其他'
}

// ==================== 公告管理 ====================
const announcementContent = ref('')
const announcementShowOnce = ref(true)
const announcementLoading = ref(false)
const announcementSaving = ref(false)
const announcementUpdatedAt = ref<number | null>(null)
const announcementUpdatedBy = ref('')

async function fetchAnnouncement() {
  announcementLoading.value = true
  try {
    const result = await userStore.getAnnouncement()
    if (result.ok) {
      announcementContent.value = result.data.content || ''
      announcementShowOnce.value = result.data.showOnce !== false
      announcementUpdatedAt.value = result.data.updatedAt || null
      announcementUpdatedBy.value = result.data.updatedBy || ''
    }
    else {
      toast.error(result.error || '获取公告失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取公告失败')
  }
  finally {
    announcementLoading.value = false
  }
}

async function saveAnnouncement() {
  announcementSaving.value = true
  try {
    const result = await userStore.setAnnouncement(announcementContent.value, announcementShowOnce.value)
    if (result.ok) {
      toast.success('公告已保存，将向所有用户展示')
      await fetchAnnouncement()
    }
    else {
      toast.error(result.error || '保存公告失败')
    }
  }
  catch (e: any) {
    toast.error(e?.message || '保存公告失败')
  }
  finally {
    announcementSaving.value = false
  }
}

onMounted(() => {
  fetchCards()
  fetchUsers()
  fetchLoginLogs()
  fetchAnnouncement()
  fetchCardClaimStatus()
})
</script>

<template>
  <div class="admin-panel">
    <PageTabs :value="activeTab" @update:value="(v: any) => (activeTab = v)">
      <NTab v-for="tab in tabs" :key="tab.key" :name="tab.key">
        <span class="inline-flex items-center gap-2">
          <span :class="tab.icon" />
          {{ tab.label }}
        </span>
      </NTab>
    </PageTabs>

    <!-- ==================== 卡密管理 ==================== -->
    <div v-if="activeTab === 'card'" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
          卡密管理
        </h3>
        <div class="flex gap-2">
          <BaseButton variant="secondary" size="sm" :loading="cardsLoading" @click="fetchCards">
            刷新
          </BaseButton>
          <BaseButton variant="primary" size="sm" @click="showCreateModal = true">
            创建卡密
          </BaseButton>
        </div>
      </div>

      <!-- 卡密领取开关 -->
      <div class="flex flex-wrap items-center justify-between gap-3 border border-gray-200 rounded-xl bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <div>
          <div class="text-sm text-gray-800 font-medium dark:text-gray-200">
            登录页免费领卡
          </div>
          <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            开启后，未注册用户可在登录页每 24 小时免费领取一张时间卡（当前可用库存：{{ unusedTimeCardsCount }} 张）
          </div>
        </div>
        <BaseSwitch
          :model-value="cardClaimEnabled"
          :disabled="cardClaimLoading"
          @update:model-value="toggleCardClaimStatus"
        />
      </div>

      <!-- 搜索与筛选 -->
      <div class="flex flex-wrap items-center gap-2">
        <BaseInput
          v-model="searchQuery"
          class="w-full sm:w-56"
          placeholder="搜索卡密/描述/使用者"
        />
        <BaseSelect
          v-model="filterStatus"
          class="w-full sm:w-32"
          :options="[
            { label: '全部状态', value: 'all' },
            { label: '已使用', value: 'used' },
            { label: '未使用', value: 'unused' },
            { label: '已启用', value: 'enabled' },
            { label: '已禁用', value: 'disabled' },
          ]"
        />
        <BaseSelect
          v-model="cardTypeFilter"
          class="w-full sm:w-32"
          :options="[
            { label: '全部类型', value: 'all' },
            { label: '时间卡', value: 'time' },
            { label: '额度卡', value: 'quota' },
          ]"
        />
        <div v-if="selectedCards.size > 0" class="ml-auto flex gap-2">
          <BaseButton variant="secondary" size="sm" @click="copySelectedCards">
            复制选中 ({{ selectedCards.size }})
          </BaseButton>
          <BaseButton variant="danger" size="sm" @click="deleteSelectedCards">
            删除选中
          </BaseButton>
        </div>
      </div>

      <!-- 卡密表格（宽屏） -->
      <div v-if="!isMobile" class="overflow-x-auto border border-gray-200 rounded-xl dark:border-gray-700">
        <table class="w-full min-w-[880px] text-sm">
          <thead>
            <tr class="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-700 dark:bg-gray-800/60">
              <th class="w-10 px-3 py-2.5">
                <input type="checkbox" :checked="selectAll" @change="toggleSelectAll">
              </th>
              <th class="px-3 py-2.5 font-medium">
                卡密
              </th>
              <th class="px-3 py-2.5 font-medium">
                描述
              </th>
              <th class="px-3 py-2.5 font-medium">
                类型
              </th>
              <th class="px-3 py-2.5 font-medium">
                面值
              </th>
              <th class="px-3 py-2.5 font-medium">
                状态
              </th>
              <th class="px-3 py-2.5 font-medium">
                使用者
              </th>
              <th class="px-3 py-2.5 font-medium">
                创建时间
              </th>
              <th class="px-3 py-2.5 text-right font-medium">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredCards.length === 0">
              <td colspan="9" class="px-3 py-8 text-center text-gray-400">
                {{ cardsLoading ? '加载中...' : '暂无卡密' }}
              </td>
            </tr>
            <tr
              v-for="card in filteredCards"
              :key="card.code"
              class="border-b border-gray-100 last:border-0 dark:border-gray-700/60"
            >
              <td class="px-3 py-2.5">
                <input type="checkbox" :checked="selectedCards.has(card.code)" @change="toggleSelectCard(card.code)">
              </td>
              <td class="px-3 py-2.5 font-mono text-xs">
                {{ card.code }}
              </td>
              <td class="px-3 py-2.5">
                {{ card.description }}
              </td>
              <td class="px-3 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs" :class="card.type === 'quota' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'">
                  {{ getCardTypeLabel(card) }}
                </span>
              </td>
              <td class="px-3 py-2.5">
                {{ getCardValueLabel(card) }}
              </td>
              <td class="px-3 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs" :class="card.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'">
                  {{ card.enabled ? '启用' : '禁用' }}
                </span>
                <span v-if="card.usedBy" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  已用
                </span>
              </td>
              <td class="px-3 py-2.5 text-xs">
                {{ card.usedBy || '-' }}
                <div v-if="card.usedAt" class="text-gray-400">
                  {{ formatDate(card.usedAt) }}
                </div>
              </td>
              <td class="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                {{ formatDate(card.createdAt) }}
              </td>
              <td class="px-3 py-2.5">
                <div class="flex justify-end gap-1">
                  <NButton quaternary size="tiny" @click="copyCode(card.code)">
                    复制
                  </NButton>
                  <NButton quaternary size="tiny" @click="toggleCardStatus(card)">
                    {{ card.enabled ? '禁用' : '启用' }}
                  </NButton>
                  <NButton quaternary size="tiny" type="error" @click="confirmDeleteCard(card)">
                    删除
                  </NButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 卡密卡片（窄屏） -->
      <div v-else class="space-y-3">
        <div v-if="filteredCards.length === 0" class="border border-gray-200 rounded-xl bg-white px-3 py-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800">
          {{ cardsLoading ? '加载中...' : '暂无卡密' }}
        </div>
        <div
          v-for="card in filteredCards"
          :key="card.code"
          class="border border-gray-200 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="flex items-center gap-2">
            <input type="checkbox" :checked="selectedCards.has(card.code)" @change="toggleSelectCard(card.code)">
            <span class="flex-1 font-mono text-sm font-medium break-all">
              {{ card.code }}
            </span>
            <span class="shrink-0 rounded px-1.5 py-0.5 text-xs" :class="card.type === 'quota' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'">
              {{ getCardTypeLabel(card) }}
            </span>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                描述
              </div>
              <div class="mt-0.5 break-all">
                {{ card.description || '-' }}
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                面值
              </div>
              <div class="mt-0.5">
                {{ getCardValueLabel(card) }}
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                状态
              </div>
              <div class="mt-0.5 flex flex-wrap gap-1">
                <span class="rounded px-1.5 py-0.5" :class="card.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'">
                  {{ card.enabled ? '启用' : '禁用' }}
                </span>
                <span v-if="card.usedBy" class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  已用
                </span>
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                使用者
              </div>
              <div class="mt-0.5 break-all">
                {{ card.usedBy || '-' }}
                <span v-if="card.usedAt" class="ml-1 text-gray-400 dark:text-gray-500">{{ formatDate(card.usedAt) }}</span>
              </div>
            </div>
            <div class="col-span-2">
              <div class="text-gray-400 dark:text-gray-500">
                创建时间
              </div>
              <div class="mt-0.5">
                {{ formatDate(card.createdAt) }}
              </div>
            </div>
          </div>
          <div class="mt-2.5 flex flex-wrap justify-end gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-700/60">
            <NButton quaternary size="tiny" @click="copyCode(card.code)">
              复制
            </NButton>
            <NButton quaternary size="tiny" @click="toggleCardStatus(card)">
              {{ card.enabled ? '禁用' : '启用' }}
            </NButton>
            <NButton quaternary size="tiny" type="error" @click="confirmDeleteCard(card)">
              删除
            </NButton>
          </div>
        </div>
      </div>

      <!-- 创建卡密弹窗 -->
      <div v-if="showCreateModal" class="modal-mask" @click.self="showCreateModal = false">
        <div class="modal-card">
          <h4 class="modal-title">
            创建卡密
          </h4>
          <div class="space-y-4">
            <div>
              <label class="modal-label">描述</label>
              <BaseInput v-model="newCard.description" placeholder="例如：7天体验卡" />
            </div>
            <div>
              <label class="modal-label">类型</label>
              <BaseSelect
                v-model="newCard.type"
                :options="[
                  { label: '时间卡（注册/续期）', value: 'time' },
                  { label: '额度卡（扩容账号上限）', value: 'quota' },
                ]"
              />
            </div>
            <div>
              <label class="modal-label">{{ newCard.type === 'quota' ? '额度（个）' : '天数（-1 为永久）' }}</label>
              <BaseInput v-model="newCard.days" type="number" />
            </div>
            <div>
              <label class="modal-label">生成数量（1-100）</label>
              <BaseInput v-model="newCard.count" type="number" />
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <BaseButton variant="secondary" @click="showCreateModal = false">
              取消
            </BaseButton>
            <BaseButton variant="primary" @click="createCard">
              创建
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 用户管理 ==================== -->
    <div v-if="activeTab === 'user'" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
          用户管理
        </h3>
        <BaseButton variant="secondary" size="sm" :loading="usersLoading" @click="fetchUsers">
          刷新
        </BaseButton>
      </div>

      <!-- 用户表格（宽屏） -->
      <div v-if="!isMobile" class="overflow-x-auto border border-gray-200 rounded-xl dark:border-gray-700">
        <table class="w-full min-w-[760px] text-sm">
          <thead>
            <tr class="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-700 dark:bg-gray-800/60">
              <th class="px-3 py-2.5 font-medium">
                用户名
              </th>
              <th class="px-3 py-2.5 font-medium">
                角色
              </th>
              <th class="px-3 py-2.5 font-medium">
                卡密
              </th>
              <th class="px-3 py-2.5 font-medium">
                到期时间
              </th>
              <th class="px-3 py-2.5 font-medium">
                账号上限
              </th>
              <th class="px-3 py-2.5 font-medium">
                状态
              </th>
              <th class="px-3 py-2.5 font-medium">
                注册时间
              </th>
              <th class="px-3 py-2.5 text-right font-medium">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="users.length === 0">
              <td colspan="8" class="px-3 py-8 text-center text-gray-400">
                {{ usersLoading ? '加载中...' : '暂无用户' }}
              </td>
            </tr>
            <tr
              v-for="user in users"
              :key="user.username"
              class="border-b border-gray-100 last:border-0 dark:border-gray-700/60"
            >
              <td class="px-3 py-2.5 font-medium">
                {{ user.username }}
                <span v-if="user.username === currentUsername" class="ml-1 text-xs text-gray-400">（当前登录）</span>
              </td>
              <td class="px-3 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs" :class="user.role === 'admin' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'">
                  {{ user.role === 'admin' ? '管理员' : '用户' }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-xs">
                <span v-if="user.card">{{ user.card.description || user.card.code }}</span>
                <span v-else class="text-gray-400">无卡密</span>
              </td>
              <td class="px-3 py-2.5 text-xs">
                <span v-if="user.role === 'admin'">永久有效</span>
                <span v-else-if="user.card?.days === -1">永久有效</span>
                <span v-else-if="user.card?.expiresAt" :class="isUserExpired(user) ? 'text-red-600 dark:text-red-400' : ''">
                  {{ formatDate(user.card.expiresAt) }}
                </span>
                <span v-else class="text-gray-400">未激活</span>
              </td>
              <td class="px-3 py-2.5">
                {{ user.role === 'admin' ? '不限' : user.accountLimit }}
              </td>
              <td class="px-3 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs" :class="isUserBanned(user) ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'">
                  {{ isUserBanned(user) ? '已封禁' : '正常' }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                {{ formatDate(user.createdAt) }}
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap justify-end gap-1">
                  <NButton quaternary size="tiny" @click="openEditModal(user)">
                    编辑
                  </NButton>
                  <NButton v-if="user.role !== 'admin'" quaternary size="tiny" @click="openRenewModal(user)">
                    续期
                  </NButton>
                  <NButton v-if="user.role !== 'admin'" quaternary size="tiny" :type="isUserBanned(user) ? 'primary' : 'warning'" @click="toggleUserStatus(user)">
                    {{ isUserBanned(user) ? '解封' : '封禁' }}
                  </NButton>
                  <NButton v-if="user.username !== currentUsername" quaternary size="tiny" type="error" @click="confirmDeleteUser(user)">
                    删除
                  </NButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 用户卡片（窄屏） -->
      <div v-else class="space-y-3">
        <div v-if="users.length === 0" class="border border-gray-200 rounded-xl bg-white px-3 py-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800">
          {{ usersLoading ? '加载中...' : '暂无用户' }}
        </div>
        <div
          v-for="user in users"
          :key="user.username"
          class="border border-gray-200 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium break-all">
              {{ user.username }}
            </span>
            <span v-if="user.username === currentUsername" class="shrink-0 text-xs text-gray-400 dark:text-gray-500">（当前登录）</span>
            <span class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs" :class="user.role === 'admin' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'">
              {{ user.role === 'admin' ? '管理员' : '用户' }}
            </span>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                卡密
              </div>
              <div class="mt-0.5 break-all">
                <span v-if="user.card">{{ user.card.description || user.card.code }}</span>
                <span v-else class="text-gray-400 dark:text-gray-500">无卡密</span>
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                到期时间
              </div>
              <div class="mt-0.5" :class="isUserExpired(user) ? 'text-red-600 dark:text-red-400' : ''">
                <span v-if="user.role === 'admin'">永久有效</span>
                <span v-else-if="user.card?.days === -1">永久有效</span>
                <span v-else-if="user.card?.expiresAt">{{ formatDate(user.card.expiresAt) }}</span>
                <span v-else class="text-gray-400 dark:text-gray-500">未激活</span>
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                账号上限
              </div>
              <div class="mt-0.5">
                {{ user.role === 'admin' ? '不限' : user.accountLimit }}
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                状态
              </div>
              <div class="mt-0.5">
                <span class="rounded px-1.5 py-0.5" :class="isUserBanned(user) ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'">
                  {{ isUserBanned(user) ? '已封禁' : '正常' }}
                </span>
              </div>
            </div>
            <div class="col-span-2">
              <div class="text-gray-400 dark:text-gray-500">
                注册时间
              </div>
              <div class="mt-0.5">
                {{ formatDate(user.createdAt) }}
              </div>
            </div>
          </div>
          <div class="mt-2.5 flex flex-wrap justify-end gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-700/60">
            <NButton quaternary size="tiny" @click="openEditModal(user)">
              编辑
            </NButton>
            <NButton v-if="user.role !== 'admin'" quaternary size="tiny" @click="openRenewModal(user)">
              续期
            </NButton>
            <NButton v-if="user.role !== 'admin'" quaternary size="tiny" :type="isUserBanned(user) ? 'primary' : 'warning'" @click="toggleUserStatus(user)">
              {{ isUserBanned(user) ? '解封' : '封禁' }}
            </NButton>
            <NButton v-if="user.username !== currentUsername" quaternary size="tiny" type="error" @click="confirmDeleteUser(user)">
              删除
            </NButton>
          </div>
        </div>
      </div>

      <!-- 编辑用户弹窗 -->
      <div v-if="showEditModal && selectedUser" class="modal-mask" @click.self="showEditModal = false">
        <div class="modal-card">
          <h4 class="modal-title">
            编辑用户：{{ selectedUser.username }}
          </h4>
          <div class="space-y-4">
            <div>
              <label class="modal-label">用户名（留空则不变）</label>
              <BaseInput v-model="editForm.newUsername" placeholder="新用户名" />
            </div>
            <div>
              <label class="modal-label">重置密码（留空则不变）</label>
              <BaseInput v-model="editForm.password" type="password" placeholder="新密码，至少6位" />
            </div>
            <div>
              <label class="modal-label">账号上限</label>
              <BaseInput v-model="editForm.accountLimit" type="number" />
            </div>
            <div>
              <label class="modal-label">到期时间</label>
              <div class="flex items-center gap-2">
                <BaseInput v-model="editForm.expiresAt" type="datetime-local" :disabled="editForm.isPermanent" class="flex-1" />
                <label class="flex items-center gap-1 text-xs whitespace-nowrap">
                  <input v-model="editForm.isPermanent" type="checkbox">
                  永久
                </label>
              </div>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <BaseButton variant="secondary" @click="showEditModal = false">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="editLoading" @click="handleEdit">
              保存
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- 续期弹窗 -->
      <div v-if="showRenewModal && selectedUser" class="modal-mask" @click.self="showRenewModal = false">
        <div class="modal-card">
          <h4 class="modal-title">
            为用户续期：{{ selectedUser.username }}
          </h4>
          <div>
            <label class="modal-label">卡密</label>
            <BaseInput v-model="renewCardCode" placeholder="请输入时间卡或额度卡卡密" />
            <p class="mt-1 text-xs text-gray-400">
              时间卡在现有到期时间上顺延；额度卡直接提升账号上限
            </p>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <BaseButton variant="secondary" @click="showRenewModal = false">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="renewLoading" @click="handleRenew">
              确认续期
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 登录日志 ==================== -->
    <div v-if="activeTab === 'log'" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
          登录日志（共 {{ loginLogsTotal }} 条）
        </h3>
        <div class="flex gap-2">
          <BaseButton variant="secondary" size="sm" :loading="loginLogsLoading" @click="fetchLoginLogs">
            刷新
          </BaseButton>
          <BaseButton variant="danger" size="sm" @click="confirmClearLogs">
            清空日志
          </BaseButton>
        </div>
      </div>

      <!-- 登录日志表格（宽屏） -->
      <div v-if="!isMobile" class="overflow-x-auto border border-gray-200 rounded-xl dark:border-gray-700">
        <table class="w-full min-w-[720px] text-sm">
          <thead>
            <tr class="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-700 dark:bg-gray-800/60">
              <th class="px-3 py-2.5 font-medium">
                时间
              </th>
              <th class="px-3 py-2.5 font-medium">
                事件
              </th>
              <th class="px-3 py-2.5 font-medium">
                用户名
              </th>
              <th class="px-3 py-2.5 font-medium">
                失败原因
              </th>
              <th class="px-3 py-2.5 font-medium">
                IP
              </th>
              <th class="px-3 py-2.5 font-medium">
                浏览器
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loginLogs.length === 0">
              <td colspan="6" class="px-3 py-8 text-center text-gray-400">
                {{ loginLogsLoading ? '加载中...' : '暂无日志' }}
              </td>
            </tr>
            <tr
              v-for="log in loginLogs"
              :key="log.id"
              class="border-b border-gray-100 last:border-0 dark:border-gray-700/60"
            >
              <td class="px-3 py-2.5 text-xs">
                {{ formatLogTime(log.timestamp) }}
              </td>
              <td class="px-3 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs" :class="getEventClass(log.event)">
                  {{ getEventLabel(log.event) }}
                </span>
              </td>
              <td class="px-3 py-2.5">
                {{ log.username }}
              </td>
              <td class="px-3 py-2.5 text-xs">
                {{ getErrorTypeLabel(log.errorType) }}
              </td>
              <td class="px-3 py-2.5 font-mono text-xs">
                {{ log.ip }}
              </td>
              <td class="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                {{ parseBrowser(log.userAgent) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 登录日志卡片（窄屏） -->
      <div v-else class="space-y-3">
        <div v-if="loginLogs.length === 0" class="border border-gray-200 rounded-xl bg-white px-3 py-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800">
          {{ loginLogsLoading ? '加载中...' : '暂无日志' }}
        </div>
        <div
          v-for="log in loginLogs"
          :key="log.id"
          class="border border-gray-200 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="flex items-center gap-2">
            <span class="shrink-0 rounded px-1.5 py-0.5 text-xs" :class="getEventClass(log.event)">
              {{ getEventLabel(log.event) }}
            </span>
            <span class="ml-auto shrink-0 text-xs text-gray-400 dark:text-gray-500">
              {{ formatLogTime(log.timestamp) }}
            </span>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                用户名
              </div>
              <div class="mt-0.5 break-all">
                {{ log.username }}
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                失败原因
              </div>
              <div class="mt-0.5">
                {{ getErrorTypeLabel(log.errorType) }}
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                IP
              </div>
              <div class="mt-0.5 font-mono break-all">
                {{ log.ip }}
              </div>
            </div>
            <div>
              <div class="text-gray-400 dark:text-gray-500">
                浏览器
              </div>
              <div class="mt-0.5 break-all">
                {{ parseBrowser(log.userAgent) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 公告管理 ==================== -->
    <div v-if="activeTab === 'announcement'" class="space-y-4">
      <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
        全站公告
      </h3>

      <div class="border border-gray-200 rounded-xl bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div class="space-y-4">
          <div>
            <label class="modal-label">公告内容</label>
            <BaseTextarea
              v-model="announcementContent"
              :rows="6"
              placeholder="输入公告内容，保存后所有用户登录时将看到该公告"
            />
          </div>
          <BaseSwitch
            v-model="announcementShowOnce"
            label="仅提示一次（用户点击确认后不再显示）"
          />
          <div v-if="announcementUpdatedAt" class="text-xs text-gray-400">
            上次更新：{{ formatDate(announcementUpdatedAt) }}
            <span v-if="announcementUpdatedBy"> by {{ announcementUpdatedBy }}</span>
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <BaseButton variant="secondary" :loading="announcementLoading" @click="fetchAnnouncement">
            重新加载
          </BaseButton>
          <BaseButton variant="primary" :loading="announcementSaving" @click="saveAnnouncement">
            保存公告
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 通用确认弹窗 -->
    <ConfirmModal
      :show="confirmVisible"
      :title="confirmConfig.title"
      :message="confirmConfig.message"
      :type="confirmConfig.type"
      :loading="confirmConfig.loading"
      @confirm="handleConfirm"
      @cancel="handleConfirmCancel"
    />
  </div>
</template>

<style scoped>
.admin-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 弹窗遮罩与卡片 */
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal-card {
  width: 100%;
  max-width: 440px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 22px;
  border-radius: 16px;
  background: var(--ui-bg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}

.modal-title {
  margin: 0 0 16px;
  color: var(--ui-ink);
  font-size: 16px;
  font-weight: 700;
}

.modal-label {
  display: block;
  margin-bottom: 6px;
  color: var(--ui-muted);
  font-size: 12px;
  font-weight: 600;
}
</style>
