import { onUnmounted, ref } from 'vue'

/** 响应式媒体查询：CSS media query 的 reactive 封装，用于窄屏切换布局 */
export function useMediaQuery(query: string) {
  const matches = ref(typeof window !== 'undefined' && window.matchMedia(query).matches)
  let mql: MediaQueryList | undefined

  function update() {
    matches.value = !!mql?.matches
  }

  if (typeof window !== 'undefined') {
    mql = window.matchMedia(query)
    mql.addEventListener('change', update)
  }

  onUnmounted(() => {
    mql?.removeEventListener('change', update)
  })

  return matches
}
