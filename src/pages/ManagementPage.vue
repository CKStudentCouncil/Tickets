<template>
  <div
    v-if="auth.loading || checkingAdmin"
    class="state-screen"
  >
    <p>{{ auth.loading ? '載入中...' : '驗證權限中...' }}</p>
  </div>

  <div
    v-else-if="!canManageOrders"
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
                  本校學生
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

            <label class="field">
              <span>五、票券總量</span>

              <input
                v-model.number="ticketType.totalTicketQuantity"
                type="number"
                min="0"
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
import {
  doc,
  getDoc,
  setDoc
} from 'firebase/firestore'

import { db } from 'src/boot/firebase'

import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'

import {
  USE_MOCK_ORDERS,
  MOCK_ALLOW_ADMIN_WITHOUT_AUTH
} from 'src/config/app'

const auth = useAuthStore()

const canManageOrders = computed(
  () =>
    auth.isSuperAdmin ||
    (
      USE_MOCK_ORDERS &&
      MOCK_ALLOW_ADMIN_WITHOUT_AUTH
    )
)

const toast = useToastStore()

const displayName = ref('管理員')
const checkingAdmin = ref(true)

const TICKET_TYPES_COLLECTION = 'settings'
const TICKET_TYPES_DOC_ID = 'ticketTypes'

const ticketTypeForm = ref([])
const loadingTicketTypes = ref(false)
const savingTicketTypes = ref(false)

function createEmptyTicketType() {
  return {
    id:
      (
        typeof crypto !== 'undefined' &&
        crypto.randomUUID &&
        crypto.randomUUID()
      ) ||
      `ticket-${Date.now()}-${Math.random().toString(16).slice(2)}`,

    name: '',

    eligibleBuyerIdentity:
      'campus_students',

    salesStartTime: '',

    salesEndTime: '',

    price: 0,

    totalTicketQuantity: 0,

    unlimited: false,

    purchaseLimitPerPerson: 1
  }
}

function getPart(value, part) {
  const [
    date = '',
    time = ''
  ] = (value || '').split('T')

  return part === 'date'
    ? date
    : time.slice(0, 5)
}

function setPart(
  ticketType,
  key,
  part,
  val,
  defaultTime
) {
  const [
    currentDate = '',
    currentTime = ''
  ] = (ticketType[key] || '').split('T')

  const date =
    part === 'date'
      ? val
      : currentDate

  const time =
    (
      part === 'time'
        ? val
        : currentTime.slice(0, 5)
    ) || defaultTime

  ticketType[key] =
    date
      ? `${date}T${time}`
      : ''
}

function toInputValue(date) {
  const pad = (number) =>
    String(number).padStart(2, '0')

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}`
  )
}

function setStartNow(ticketType) {
  ticketType.salesStartTime =
    toInputValue(new Date())
}

function setEndAfter(
  ticketType,
  days
) {
  const base =
    ticketType.salesStartTime
      ? new Date(ticketType.salesStartTime)
      : new Date()

  base.setDate(
    base.getDate() + days
  )

  ticketType.salesEndTime =
    toInputValue(base)
}

function salePeriodSummary(ticketType) {
  if (
    !ticketType.salesStartTime ||
    !ticketType.salesEndTime
  ) {
    return null
  }

  const start =
    new Date(
      ticketType.salesStartTime
    )

  const end =
    new Date(
      ticketType.salesEndTime
    )

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
    const settingsDoc =
      await getDoc(
        doc(
          db,
          TICKET_TYPES_COLLECTION,
          TICKET_TYPES_DOC_ID
        )
      )

    const savedTypes =
      settingsDoc.exists()
        ? settingsDoc.data().types
        : null

    ticketTypeForm.value =
      Array.isArray(savedTypes) &&
      savedTypes.length
        ? savedTypes.map(
            (ticketType) => ({
              ...createEmptyTicketType(),
              ...ticketType,
              price:
                Number(
                  ticketType.price
                ) || 0
            })
          )
        : [
            createEmptyTicketType()
          ]
  } catch (error) {
    console.error(
      'Load ticket type settings error:',
      error
    )

    toast.show(
      '票種設定載入失敗，請重新整理後再試'
    )

    ticketTypeForm.value = [
      createEmptyTicketType()
    ]
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
      new Date(
        ticketType.salesEndTime
      ) <=
      new Date(
        ticketType.salesStartTime
      )
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

    if (
      Number(
        ticketType.totalTicketQuantity
      ) < 0
    ) {
      toast.show(
        `「${label}」的票券總量不可為負數`
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
    await setDoc(
      doc(
        db,
        TICKET_TYPES_COLLECTION,
        TICKET_TYPES_DOC_ID
      ),
      {
        types:
          ticketTypeForm.value.map(
            (ticketType) => ({
              id: ticketType.id,

              name:
                ticketType.name.trim(),

              eligibleBuyerIdentity:
                ticketType.eligibleBuyerIdentity,

              salesStartTime:
                ticketType.salesStartTime,

              salesEndTime:
                ticketType.salesEndTime,

              price:
                Number(
                  ticketType.price
                ) || 0,

              totalTicketQuantity:
                Number(
                  ticketType.totalTicketQuantity
                ) || 0,

              unlimited:
                !!ticketType.unlimited,

              purchaseLimitPerPerson:
                ticketType.unlimited
                  ? null
                  : Number(
                      ticketType.purchaseLimitPerPerson
                    ) || 1
            })
          ),

        updatedAt:
          new Date(),

        updatedBy:
          displayName.value
      }
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

async function loadAdminProfile() {
  if (!auth.user) {
    return
  }

  try {
    const userDoc =
      await getDoc(
        doc(
          db,
          'users',
          auth.user.uid
        )
      )

    displayName.value =
      userDoc.exists()
        ? (
            userDoc.data().name ||
            auth.user.displayName ||
            auth.user.email
          )
        : (
            auth.user.displayName ||
            auth.user.email
          )
  } catch {
    displayName.value =
      auth.user.displayName ||
      auth.user.email ||
      '管理員'
  }
}

onMounted(
  async () => {
    await loadAdminProfile()

    checkingAdmin.value = false

    if (
      canManageOrders.value
    ) {
      loadTicketTypeSettings()
    }
  }
)
</script>

<style scoped>
@import 'src/css/app.scss';
@import 'src/css/managementpage.scss';

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