<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { onMounted, ref } from 'vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const visible = ref(false)
const content = ref('')
const showOnce = ref(true)

async function checkAnnouncement() {
  if (!userStore.isLoggedIn)
    return
  try {
    const result = await userStore.getAnnouncement()
    if (result.ok && result.data.shouldShow && String(result.data.content || '').trim()) {
      content.value = String(result.data.content)
      showOnce.value = result.data.showOnce !== false
      visible.value = true
    }
  }
  catch (e) {
    console.error('获取公告失败:', e)
  }
}

async function handleClose() {
  visible.value = false
  try {
    await userStore.markAnnouncementRead()
  }
  catch (e) {
    console.error('标记公告已读失败:', e)
  }
}

onMounted(checkAnnouncement)
</script>

<template>
  <div v-if="visible" class="announcement-mask" @click.self="handleClose">
    <div class="announcement-card" role="dialog" aria-modal="true">
      <div class="announcement-header">
        <span class="announcement-icon i-carbon-notification" />
        <h3 class="announcement-title">
          系统公告
        </h3>
      </div>
      <div class="announcement-body">
        <p class="announcement-content">
          {{ content }}
        </p>
      </div>
      <div class="announcement-footer">
        <NButton type="primary" size="small" @click="handleClose">
          我知道了
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.announcement-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.announcement-card {
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  background: var(--ui-bg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
  animation: announcementIn 0.25s ease;
}

@keyframes announcementIn {
  from {
    opacity: 0;
    transform: translateY(-14px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.announcement-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--ui-border);
}

.announcement-icon {
  color: var(--ui-primary);
  font-size: 20px;
}

.announcement-title {
  margin: 0;
  color: var(--ui-ink);
  font-size: 16px;
  font-weight: 700;
}

.announcement-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.announcement-content {
  margin: 0;
  color: var(--ui-ink);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.announcement-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--ui-border);
}
</style>
