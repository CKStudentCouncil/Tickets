<template>
  <div
    v-if="auth.loading"
    class="state-screen"
  >
    <p>載入中...</p>
  </div>

  <div
    v-else-if="!auth.isSuperAdmin"
    class="state-screen"
  >
    <h2>權限不足</h2>
    <button
      type="button"
      class="btn"
      @click="$router.push('/')"
    >
      回到首頁
    </button>
  </div>

  <div
    v-else
    class="admin-page"
  >
    <div class="page-heading">
      <p class="eyebrow">後台管理</p>
      <h1>票種管理</h1>
    </div>

    <div class="panel shop-open-panel">
      <div class="notify-header">
        <h2>開賣時間</h2>

        <div class="ticket-type-header-actions">
          <button
            type="button"
            class="btn-outline"
            :disabled="savingShopOpenAt || !shop.ready || shop.isOpen(now)"
            @click="openShopNow"
          >
            立即開賣
          </button>

          <button
            type="button"
            class="btn"
            :disabled="savingShopOpenAt || !shop.ready"
            @click="saveShopOpenTime"
          >
            {{ savingShopOpenAt ? '儲存中...' : '儲存開賣時間' }}
          </button>
        </div>
      </div>

      <p class="panel-copy">
        開賣前，前台的首頁與購票頁面會顯示 Coming Soon（工作人員不受影響）；時間一到，正在等候的訪客會自動進入首頁。
        實際可下單的時間仍以下方各票種的販售時段為準。
      </p>

      <div class="time-group shop-open-group">
        <div class="time-label">
          開賣時間（臺灣時間）
        </div>

        <div class="time-inputs">
          <input
            type="date"
            :value="getPart(shopOpenInput, 'date')"
            @input="shopOpenInput = setDateTimePart(shopOpenInput, 'date', $event.target.value, '12:00')"
          >

          <input
            type="time"
            :value="getPart(shopOpenInput, 'time')"
            @input="shopOpenInput = setDateTimePart(shopOpenInput, 'time', $event.target.value, '12:00')"
          >
        </div>

        <p
          v-if="shop.ready"
          class="time-summary"
          :class="{ ok: shop.isOpen(now) }"
        >
          {{ shopOpenSummary }}
        </p>
      </div>
    </div>

    <div class="panel ticket-type-panel">
      <div class="notify-header">
        <h2>票種管理</h2>

        <div class="ticket-type-header-actions">
          <button
            type="button"
            class="btn-outline"
            :disabled="loadingTicketTypes"
            @click="addTicketType"
          >
            + 新增票種
          </button>

          <button
            type="button"
            class="btn"
            :disabled="savingTicketTypes || loadingTicketTypes"
            @click="saveTicketTypeSettings"
          >
            {{ savingTicketTypes ? '儲存中...' : '儲存票種設定' }}
          </button>
        </div>
      </div>

      <p class="panel-copy">
        可分類設定票種名稱、購買資格、販售時段、票價、總量與每人限購量
      </p>

      <br>

      <p
        v-if="loadingTicketTypes"
        class="empty"
      >
        票種設定載入中...
      </p>

      <template v-else>
        <div
          v-for="ticketType in ticketTypeForm"
          :key="ticketType.id"
          class="ticket-type-card"
        >
          <div class="ticket-type-card-header">
            <label class="field ticket-name-field">
              <span>一、票種名稱</span>

              <input
                v-model="ticketType.name"
                type="text"
                placeholder="例如：早鳥票"
              >
            </label>

            <button
              type="button"
              class="btn-outline danger"
              :disabled="ticketTypeForm.length <= 1"
              @click="removeTicketType(ticketType.id)"
            >
              刪除此票種
            </button>
          </div>

          <div class="ticket-type-grid">
            <label class="field">
              <span>二、可購買資格</span>

              <select
                v-model="ticketType.eligibleBuyerIdentity"
                class="select-field"
              >
                <option value="campus_students">
                  本校學生（限建國中學）
                </option>

                <option value="all_users">
                  所有使用者
                </option>
              </select>
            </label>

            <div class="field ticket-time-field">
              <span>三、販售時段</span>

              <div class="time-range">
                <div class="time-group">
                  <div class="time-label">
                    開始
                  </div>

                  <div class="time-inputs">
                    <input
                      type="date"
                      :value="getPart(ticketType.salesStartTime, 'date')"
                      @input="setPart(
                        ticketType,
                        'salesStartTime',
                        'date',
                        $event.target.value,
                        '00:00'
                      )"
                    >

                    <input
                      type="time"
                      :value="getPart(ticketType.salesStartTime, 'time')"
                      @input="setPart(
                        ticketType,
                        'salesStartTime',
                        'time',
                        $event.target.value,
                        '00:00'
                      )"
                    >
                  </div>

                  <div class="time-presets">
                    <button
                      type="button"
                      class="time-chip"
                      @click="setStartNow(ticketType)"
                    >
                      現在
                    </button>
                  </div>
                </div>

                <div class="time-group">
                  <div class="time-label">
                    結束
                  </div>

                  <div class="time-inputs">
                    <input
                      type="date"
                      :value="getPart(ticketType.salesEndTime, 'date')"
                      @input="setPart(
                        ticketType,
                        'salesEndTime',
                        'date',
                        $event.target.value,
                        '23:59'
                      )"
                    >

                    <input
                      type="time"
                      :value="getPart(ticketType.salesEndTime, 'time')"
                      @input="setPart(
                        ticketType,
                        'salesEndTime',
                        'time',
                        $event.target.value,
                        '23:59'
                      )"
                    >
                  </div>

                  <div class="time-presets">
                    <button
                      type="button"
                      class="time-chip"
                      @click="setEndAfter(ticketType, 1)"
                    >
                      +1 天
                    </button>

                    <button
                      type="button"
                      class="time-chip"
                      @click="setEndAfter(ticketType, 7)"
                    >
                      +7 天
                    </button>

                    <button
                      type="button"
                      class="time-chip"
                      @click="setEndAfter(ticketType, 30)"
                    >
                      +30 天
                    </button>
                  </div>
                </div>
              </div>

              <p
                v-if="salePeriodSummary(ticketType)"
                class="time-summary"
                :class="salePeriodSummary(ticketType).level"
              >
                {{ salePeriodSummary(ticketType).text }}
              </p>
            </div>

            <label class="field">
              <span>四、票價</span>

              <div class="price-input">
                <span>NT$</span>

                <input
                  v-model.number="ticketType.price"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="例如：300"
                >
              </div>
            </label>

            <label class="field ticket-limit-field">
              <span>五、票券總量</span>

              <div class="ticket-limit-controls">
                <input
                  v-model="ticketType.unlimitedStock"
                  type="checkbox"
                >

                <span>不限量</span>
              </div>

              <input
                v-model.number="ticketType.totalTicketQuantity"
                type="number"
                min="1"
                placeholder="請輸入張數"
                :disabled="ticketType.unlimitedStock"
              >
            </label>

            <label class="field ticket-limit-field">
              <span>六、每人限購數量</span>

              <div class="ticket-limit-controls">
                <input
                  v-model="ticketType.unlimited"
                  type="checkbox"
                >

                <span>不限購</span>
              </div>

              <input
                v-model.number="ticketType.purchaseLimitPerPerson"
                type="number"
                min="1"
                :disabled="ticketType.unlimited"
              >
            </label>
          </div>
        </div>

        <p
          v-if="!ticketTypeForm.length"
          class="empty"
        >
          尚無票種，請點選「新增票種」以建立。
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useShopStore } from 'src/stores/shop'
import { useToastStore } from 'src/stores/toast'
import { useNow } from 'src/composables/useNow'
import { fetchTicketTypes, saveTicketTypes } from 'src/services/ticketTypeService'
import { saveShopOpenAt } from 'src/services/shopService'
import {
  addDaysInputValue,
  formatCountdown,
  formatDateTime,
  getDateTimePart as getPart,
  parseDate,
  setDateTimePart,
  toDateTimeInput,
  toDateTimeInputValue,
  toStoredDateTime
} from 'src/utils/datetime'

const auth = useAuthStore()
const shop = useShopStore()
const toast = useToastStore()
const now = useNow()

/* ---------- shop opening time (settings/shop) ---------- */

const shopOpenInput = ref('')
const savingShopOpenAt = ref(false)

const shopOpenSummary = computed(() => {
  const when = formatDateTime(shop.openAt)
  const source = shop.isCustomised ? '' : '（預設時間）'

  return shop.isOpen(now.value)
    ? `已開賣・${when} 起${source}`
    : `尚未開賣・${when} 開賣${source}，還有 ${formatCountdown(shop.openAt, now.value)}`
})

async function storeShopOpenAt(inputValue, message) {
  savingShopOpenAt.value = true

  try {
    // stored with an explicit +08:00 so every device reads the same instant
    await saveShopOpenAt(toStoredDateTime(inputValue), auth.user.uid)
    shopOpenInput.value = inputValue
    toast.show(message)
  } catch (error) {
    console.error('Save shop opening time error:', error)
    toast.show('開賣時間儲存失敗，請稍後再試')
  } finally {
    savingShopOpenAt.value = false
  }
}

function saveShopOpenTime() {
  if (!parseDate(shopOpenInput.value)) {
    toast.show('請填寫開賣日期與時間')
    return
  }

  storeShopOpenAt(shopOpenInput.value, '開賣時間已儲存')
}

function openShopNow() {
  if (!window.confirm('確定要立即開賣嗎？所有訪客將可立即進入首頁與購票頁面（實際可下單時間仍依各票種的販售時段）。')) return

  storeShopOpenAt(toDateTimeInputValue(new Date()), '已立即開賣')
}

async function loadShopOpenTime() {
  await shop.init()
  shopOpenInput.value = toDateTimeInputValue(shop.openAt)
}

/* ---------- ticket types ---------- */

const ticketTypeForm = ref([])
const loadingTicketTypes = ref(false)
const savingTicketTypes = ref(false)

function createEmptyTicketType() {
  return {
    // randomUUID only exists in secure contexts (https / localhost)
    id:
      crypto.randomUUID?.() ??
      `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    name: '',
    eligibleBuyerIdentity: 'campus_students',
    salesStartTime: '',
    salesEndTime: '',
    price: 0,
    // blank on purpose: the admin must enter a total or tick 不限量 (PARTY-18)
    totalTicketQuantity: null,
    unlimitedStock: false,
    unlimited: false,
    purchaseLimitPerPerson: 1
  }
}

function setPart(ticketType, key, part, value, defaultTime) {
  ticketType[key] = setDateTimePart(ticketType[key], part, value, defaultTime)
}

function setStartNow(ticketType) {
  ticketType.salesStartTime = toDateTimeInputValue(new Date())
}

function setEndAfter(ticketType, days) {
  ticketType.salesEndTime = addDaysInputValue(ticketType.salesStartTime, days)
}

function salePeriodSummary(ticketType) {
  if (
    !ticketType.salesStartTime ||
    !ticketType.salesEndTime
  ) {
    return null
  }

  const start = parseDate(ticketType.salesStartTime)
  const end = parseDate(ticketType.salesEndTime)

  if (!start || !end) {
    return { text: '時間格式錯誤', level: 'error' }
  }

  if (end <= start) {
    return {
      text:
        '結束時間必須晚於開始時間',
      level: 'error'
    }
  }

  const now = new Date()

  const status =
    now < start
      ? '尚未開始'
      : now > end
        ? '已結束'
        : '販售中'

  const days =
    Math.ceil(
      (end - start) /
      86400000
    )

  return {
    text:
      `${status}・共 ${days} 天`,

    level:
      status === '販售中'
        ? 'ok'
        : ''
  }
}

function addTicketType() {
  ticketTypeForm.value.push(
    createEmptyTicketType()
  )
}

function removeTicketType(id) {
  if (
    ticketTypeForm.value.length <= 1
  ) {
    return
  }

  if (
    !window.confirm(
      '確定要刪除此票種嗎？此動作無法復原。'
    )
  ) {
    return
  }

  ticketTypeForm.value =
    ticketTypeForm.value.filter(
      (ticketType) =>
        ticketType.id !== id
    )
}

async function loadTicketTypeSettings() {
  loadingTicketTypes.value = true

  try {
    const savedTypes = await fetchTicketTypes()

    ticketTypeForm.value = savedTypes.length
      ? savedTypes.map((ticketType) => ({
          ...createEmptyTicketType(),
          ...ticketType,
          salesStartTime: toDateTimeInput(ticketType.salesStartTime),
          salesEndTime: toDateTimeInput(ticketType.salesEndTime),
          // old entries saved 0 meaning "unlimited"; make the admin choose again
          totalTicketQuantity: Number(ticketType.totalTicketQuantity) > 0
            ? Number(ticketType.totalTicketQuantity)
            : null,
          price: Number(ticketType.price) || 0
        }))
      : [createEmptyTicketType()]
  } catch (error) {
    console.error('Load ticket type settings error:', error)
    toast.show('票種設定載入失敗，請重新整理後再試')
    ticketTypeForm.value = [createEmptyTicketType()]
  } finally {
    loadingTicketTypes.value = false
  }
}

function validateTicketTypeForm() {
  if (
    !ticketTypeForm.value.length
  ) {
    toast.show(
      '請至少新增一種票種'
    )

    return false
  }

  for (
    const ticketType
    of ticketTypeForm.value
  ) {
    const label =
      ticketType.name.trim() ||
      '（未命名票種）'

    if (
      !ticketType.name.trim()
    ) {
      toast.show(
        '請填寫每個票種的名稱'
      )

      return false
    }

    if (
      !ticketType.salesStartTime ||
      !ticketType.salesEndTime
    ) {
      toast.show(
        `請填寫「${label}」的販售起訖時間`
      )

      return false
    }

    if (
      parseDate(ticketType.salesEndTime) <=
      parseDate(ticketType.salesStartTime)
    ) {
      toast.show(
        `「${label}」的販售結束時間必須晚於開始時間`
      )

      return false
    }

    if (
      Number(ticketType.price) < 0
    ) {
      toast.show(
        `「${label}」的票價不可為負數`
      )

      return false
    }

    // a missing price would otherwise sell tickets for NT$ 0
    if (
      !Number(ticketType.price) &&
      !window.confirm(`「${label}」的票價為 0，確定要免費販售嗎？`)
    ) {
      return false
    }

    const total = Number(ticketType.totalTicketQuantity)

    if (
      !ticketType.unlimitedStock &&
      (ticketType.totalTicketQuantity === null ||
        ticketType.totalTicketQuantity === '' ||
        !Number.isInteger(total) ||
        total < 1)
    ) {
      toast.show(
        `請填寫「${label}」的票券總量（正整數），或勾選「不限量」`
      )

      return false
    }

    if (
      !ticketType.unlimited &&
      Number(
        ticketType.purchaseLimitPerPerson
      ) < 1
    ) {
      toast.show(
        `「${label}」的每人限購數量至少為 1`
      )

      return false
    }
  }

  return true
}

async function saveTicketTypeSettings() {
  if (
    !validateTicketTypeForm()
  ) {
    return
  }

  savingTicketTypes.value = true

  try {
    await saveTicketTypes(
      ticketTypeForm.value.map((ticketType) => ({
        id: ticketType.id,
        name: ticketType.name.trim(),
        eligibleBuyerIdentity: ticketType.eligibleBuyerIdentity,
        // stored with an explicit +08:00 so the server reads the same instant
        salesStartTime: toStoredDateTime(ticketType.salesStartTime),
        salesEndTime: toStoredDateTime(ticketType.salesEndTime),
        price: Number(ticketType.price) || 0,
        totalTicketQuantity: ticketType.unlimitedStock
          ? null
          : Number(ticketType.totalTicketQuantity),
        unlimitedStock: !!ticketType.unlimitedStock,
        unlimited: !!ticketType.unlimited,
        purchaseLimitPerPerson: ticketType.unlimited
          ? null
          : Number(ticketType.purchaseLimitPerPerson) || 1
      })),
      // uid, not name/email: this document is publicly readable (PARTY-26)
      auth.user.uid
    )

    toast.show(
      '票種設定已儲存'
    )
  } catch (error) {
    console.error(
      'Save ticket type settings error:',
      error
    )

    toast.show(
      '票種設定儲存失敗，請稍後再試'
    )
  } finally {
    savingTicketTypes.value = false
  }
}

onMounted(() => {
  if (!auth.isSuperAdmin) return

  loadShopOpenTime()
  loadTicketTypeSettings()
})
</script>

<style scoped>
@import 'src/css/managementpage.scss';

.shop-open-panel {
  margin-bottom: 24px;
}

.shop-open-group {
  max-width: 460px;
}

.price-input {
  display: flex;
  align-items: center;
  gap: 10px;
}

.price-input span {
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 700;
  color: var(--lunar, #9aa3ac);
}

.price-input input {
  flex: 1;
  min-width: 0;
}
</style>