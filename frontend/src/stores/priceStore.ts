import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORE_KEY = 'mhxy_price_v1'

interface PricePersist {
  goldPrice: number
  discount: number
  serverName: string | null
  serverGoldPrice: number | null
}

function load(): PricePersist {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<PricePersist>
      return {
        goldPrice: typeof p.goldPrice === 'number' ? p.goldPrice : 100,
        discount: typeof p.discount === 'number' ? p.discount : 1,
        serverName: p.serverName ?? null,
        serverGoldPrice: p.serverGoldPrice ?? null,
      }
    }
  } catch {
    /* ignore */
  }
  return { goldPrice: 100, discount: 1, serverName: null, serverGoldPrice: null }
}

// 全局金价 / 折扣（手动输入，本地存储）
export const usePriceStore = defineStore('price', () => {
  const init = load()
  const goldPrice = ref<number>(init.goldPrice) // 元 / 3000万梦幻币
  const discount = ref<number>(init.discount) // 1 = 无折扣
  const serverName = ref<string | null>(init.serverName) // 上次选的服务器名
  const serverGoldPrice = ref<number | null>(init.serverGoldPrice) // 缓存的该服金价

  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          goldPrice: goldPrice.value,
          discount: discount.value,
          serverName: serverName.value,
          serverGoldPrice: serverGoldPrice.value,
        }),
      )
    } catch {
      /* ignore */
    }
  }

  function setGoldPrice(v: number) {
    goldPrice.value = v
    persist()
  }
  function setDiscount(v: number) {
    discount.value = v
    persist()
  }
  // 从服务器金价选择：写入金价框（与手动填等价）+ 记录服务器名，下次自动回填
  function setGoldFromServer(name: string, price: number) {
    goldPrice.value = price
    serverName.value = name
    serverGoldPrice.value = price
    persist()
  }
  // 清除服务器选择（保留当前金价框数值）
  function clearServer() {
    serverName.value = null
    serverGoldPrice.value = null
    persist()
  }

  return {
    goldPrice,
    discount,
    serverName,
    serverGoldPrice,
    setGoldPrice,
    setDiscount,
    setGoldFromServer,
    clearServer,
  }
})
