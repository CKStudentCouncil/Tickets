<template>
  <div class="product-page">
    <router-link 
      to="/"
      class="back-button"
      aria-label="回到票種列表"
      style="margin-top: 4ch">
        <q-icon name="arrow_back" size="18px" />
    </router-link><br />

    <div v-if="loading" class="ticket-state">
      <p><span class="loading-dot" />載入中…</p>
    </div>

    <div v-else-if="loadError" class="ticket-state">
      <h3>資訊載入失敗</h3>
      <p>請重新整理頁面後再試</p>
      <button type="button" class="btn" @click="loadTicketTypes">
        重新載入
      </button>
    </div>

    <div v-else-if="!ticketType" class="ticket-state">
      <h3>找不到這個票種</h3>
      <p>這個票種可能已下架，或連結有誤</p>
      <router-link to="/" class="btn">回到列表</router-link>
    </div>

    <div v-else class="product-detail">
      <section class="purchase-card" style="min-width: 100%;">
        <p class="eyebrow">CK PARTY NIGHT</p>
        <div style="margin-bottom: 2ch;"></div>
        <h1>{{ ticketType.name }} {{ ticketType.price ? ` - NT$ ${ticketType.price.toLocaleString()}` : '' }}</h1>
        <div style="margin-bottom: 2ch;"></div>


        <p
          v-if="purchaseLimit"
          class="ticket-limit"
        >
          每人限購 {{ purchaseLimit }} 張
        </p>

        <p v-if="isTestTicket" class="ticket-limit">
          測試票：只有管理員看得到、也只有管理員能購買，一般使用者不會看到這個票種
        </p>

        <p v-if="isCampusTicket" class="ticket-limit">
          限建中在學學生以 @{{ SCHOOL_ACCOUNT_DOMAIN }} 帳號登入購買，領票時須出示建中學生證
        </p>

        <p v-if="isFriendSchoolsTicket" class="ticket-limit">
          限建中及友校（{{ FRIEND_SCHOOLS.join('、') }}）在學學生以學校帳號登入購買，領票時須出示學生證
        </p>

        <template v-if="studentOnlyUntil">
          <p v-if="isStudentPhase" class="ticket-limit">
            目前僅開放學生以學校帳號（Email 結尾為 edu.tw）登入購買，{{ formatDateTime(studentOnlyUntil) }} 起開放所有人
          </p>

          <p class="ticket-limit">
            以學校帳號（Email 結尾為 edu.tw）購買或填寫學生切結者，須確認為在學學生，領票時須出示學生證，資格不符者不得領票；其他以一般帳號（如 Gmail）購買者不需要
          </p>
        </template>

        <div class="divider" />

        <aside v-if="pendingCheckout" class="checkout-recovery" role="status">
          <strong>上次訂單尚未取得確認</strong>
          <p>請先確認或重試原訂單，避免重複購票。重新整理頁面後仍可繼續。</p>
          <button type="button" class="primary-button" :disabled="submitting" @click="retryPendingOrder">
            {{ submitting ? '確認中…' : '確認或重試原訂單' }}
          </button>
          <TurnstileWidget
            v-if="TURNSTILE_SITE_KEY && !showOrderForm"
            ref="turnstile"
            v-model="turnstileToken"
            action="checkout"
          />
          <router-link to="/orders">查看我的訂單</router-link>
          <p v-if="!showOrderForm && orderError" class="order-error" role="alert">{{ orderError }}</p>
        </aside>

        <p v-if="status.state === 'upcoming'" class="ticket-limit">
          {{ formatDateTime(ticketType.salesStartTime) }} 開賣・倒數 {{ formatCountdown(ticketType.salesStartTime, now) }}
        </p>
        <p v-else-if="status.state === 'unavailable'" class="ticket-limit">開賣時間尚未公布</p>
        <p v-else-if="status.state === 'ended'" class="ticket-limit">此票種已結束販售</p>
        <p v-else-if="status.state === 'soldOut'" class="ticket-limit">此票種已售罄</p>

        <template v-if="status.state === 'selling' && !showOrderForm">
          <button
            v-if="!auth.isLoggedIn"
            type="button"
            class="primary-button"
            @click="goToLogin"
          >
            登入後購買
          </button>

          <template v-else-if="needsOtherAccount">
            <p v-if="isCampusTicket" class="account-warning">
              此票種限使用建中帳號（@{{ SCHOOL_ACCOUNT_DOMAIN }}）購買，你目前登入的是
              <span class="account-email">{{ auth.email }}</span>。
            </p>
            <p v-else-if="isFriendSchoolsTicket" class="account-warning">
              此票種限建中及友校學生以學校帳號購買，你目前登入的是
              <span class="account-email">{{ auth.email }}</span>。
            </p>
            <p v-else class="account-warning">
              目前僅開放學校帳號（Email 結尾為 edu.tw）購買，你目前登入的是
              <span class="account-email">{{ auth.email }}</span>，
              {{ formatDateTime(studentOnlyUntil) }} 起開放所有人（倒數 {{ formatCountdown(studentOnlyUntil, now) }}）。
            </p>
            <button type="button" class="primary-button" @click="switchAccount">
              {{ isCampusTicket ? '改用建中帳號登入' : isFriendSchoolsTicket ? '改用建中或友校帳號登入' : '改用學校帳號登入' }}
            </button>
            <button v-if="!isCampusTicket && !isFriendSchoolsTicket" type="button" class="declaration-link" @click="declarationOpen = true">
              無法使用學校帳號？填寫學生切結後購買
            </button>
          </template>

          <button
            v-else
            type="button"
            class="primary-button"
            :disabled="!!pendingCheckout"
            @click="openOrderForm"
          >
            購買 {{ ticketType.name }}
          </button>
        </template>

        <form v-if="showOrderForm" ref="orderForm" class="order-panel" novalidate @submit.prevent="submitDirectOrder">
          <p class="eyebrow">填寫訂購資訊</p>

          <div class="order-form">
            <label>
              數量
              <input type="number" v-model.number="quantity" min="1" :max="maxQuantity"
                :aria-invalid="validationAttempted && !!fieldErrors.quantity" aria-describedby="quantity-error" required>
              <span id="quantity-error" v-if="validationAttempted && fieldErrors.quantity" class="field-error">{{ fieldErrors.quantity }}</span>
            </label>

            <label>
              學校 / 身分
              <select v-model="buyer.school" :aria-invalid="validationAttempted && !!fieldErrors.school" aria-describedby="school-error" required>
                <option disabled value="">請選擇</option>
                <option v-for="s in schoolOptions" :key="s" :value="s">{{ s }}</option>
              </select>
              <span id="school-error" v-if="validationAttempted && fieldErrors.school" class="field-error">{{ fieldErrors.school }}</span>
            </label>

            <template v-if="needsClass">
              <label>
                班級
                <input v-model="buyer.class" placeholder="例：329/三數" maxlength="30"
                  :aria-invalid="validationAttempted && !!fieldErrors.class" aria-describedby="class-error" required>
                <span id="class-error" v-if="validationAttempted && fieldErrors.class" class="field-error">{{ fieldErrors.class }}</span>
              </label>

              <label>
                座號
                <input v-model="buyer.number" placeholder="例：01" maxlength="20"
                  :aria-invalid="validationAttempted && !!fieldErrors.number" aria-describedby="number-error" required>
                <span id="number-error" v-if="validationAttempted && fieldErrors.number" class="field-error">{{ fieldErrors.number }}</span>
              </label>
            </template>

            <label v-if="buyer.school === '建中老師'">
              辦公室
              <input v-model="buyer.office" placeholder="例：莊三" maxlength="100">
            </label>

            <label>
              姓名
              <input v-model="buyer.customerName" autocomplete="name" maxlength="100"
                :aria-invalid="validationAttempted && !!fieldErrors.customerName" aria-describedby="name-error" required>
              <span id="name-error" v-if="validationAttempted && fieldErrors.customerName" class="field-error">{{ fieldErrors.customerName }}</span>
            </label>

            <label>
              電話
              <input v-model="buyer.customerPhone" type="tel" autocomplete="tel" maxlength="30"
                :aria-invalid="validationAttempted && !!fieldErrors.customerPhone" aria-describedby="phone-error" required>
              <span id="phone-error" v-if="validationAttempted && fieldErrors.customerPhone" class="field-error">{{ fieldErrors.customerPhone }}</span>
            </label>

            <p class="account-row">
              確認信將寄送至：
              <span class="account-email">{{ auth.email }}</span>，送出後數分鐘內會收到
            </p>
          </div>

          <p class="order-summary">
            <span>應付金額</span>
            <strong>NT$ {{ (ticketType.price || 0) * quantity }}</strong>
          </p>

          <label class="terms-consent">
            <input v-model="acceptedTerms" type="checkbox" :aria-invalid="validationAttempted && !!fieldErrors.terms" aria-describedby="terms-error" required>
            <span>
              我已閱讀並同意
              <router-link to="/policy" target="_blank">銷售條款</router-link>
              與
              <router-link to="/terms" target="_blank">使用者條款</router-link>
            </span>
          </label>
          <p id="terms-error" v-if="validationAttempted && fieldErrors.terms" class="field-error">{{ fieldErrors.terms }}</p>

          <template v-if="needsStudentConfirm">
            <label class="terms-consent">
              <input v-model="studentConfirmed" type="checkbox" :aria-invalid="validationAttempted && !!fieldErrors.student" aria-describedby="student-error" required>
              <span>我確認我是在學學生，並了解領票時須攜帶學生證，資格不符者不得領票</span>
            </label>
            <p id="student-error" v-if="validationAttempted && fieldErrors.student" class="field-error">{{ fieldErrors.student }}</p>
          </template>

          <p v-if="usesDeclaration" class="declaration-note">你已切結為在學學生，領票時須出示學生證</p>

          <TurnstileWidget
            v-if="TURNSTILE_SITE_KEY"
            ref="turnstile"
            v-model="turnstileToken"
            action="checkout"
          />

          <p v-if="orderError" class="order-error" role="alert">{{ orderError }}</p>

          <p class="order-wait-note" :class="{ 'is-waiting': submitting }" role="status">
            同時購票的人多時，送出後需要等一下才會有結果：約 500 人同時購票最慢 15 秒、1000 人最慢 30 秒左右。請耐心等候，不要關閉或重新整理頁面。
          </p>

          <div class="order-panel-actions">
            <button
              type="button"
              class="secondary-button"
              :disabled="submitting"
              @click="closeOrderForm"
            >
              取消
            </button>

            <button
              type="submit"
              class="primary-button"
              :disabled="submitting || !!pendingCheckout || !auth.isLoggedIn || needsOtherAccount"
            >
              {{ submitting ? '送出中…' : '確認送出訂單' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <StudentDeclarationDialog v-model="declarationOpen" @agree="agreeDeclaration" />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToastStore } from 'src/stores/toast'
import { getPendingCheckout, submitOrder } from 'src/services/orderService'
import TurnstileWidget from 'src/components/TurnstileWidget.vue'
import StudentDeclarationDialog from 'src/components/StudentDeclarationDialog.vue'
import { TURNSTILE_SITE_KEY } from 'src/config/app'
import {
  ELIGIBLE_IDENTITIES,
  fetchSoldOut,
  fetchTicketTypes,
  getPurchaseLimit,
  getTicketStatus,
  isAdminOnlyType,
  isFriendSchoolsOnlyType,
  isTicketTypeListed
} from 'src/services/ticketTypeService'
import { CAMPUS_SCHOOLS, FRIEND_SCHOOLS, HOME_SCHOOL, SCHOOLS, SCHOOL_ACCOUNT_DOMAIN } from 'src/data/schools'
import { useAuthStore } from 'src/stores/auth'
import { useNow } from 'src/composables/useNow'
import { formatCountdown, formatDateTime, parseDate } from 'src/utils/datetime'

const MAX_TICKETS_PER_ORDER = 20 // same cap as functions/lib/orderValidation.js

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const ticketTypes = ref([])
const soldOut = ref({})
const loading = ref(true)
const loadError = ref(false)

// ticks every second so the buy button appears the moment sales open (PARTY-24)
const now = useNow(1000)

// a type hidden until sales open reads as 找不到 until then; so does a
// 測試票 for anyone but staff (友校幹部 and above)
const ticketType = computed(() => {
  const type = ticketTypes.value.find((t) => t.id === route.params.id)

  return type && isTicketTypeListed(type, now.value, { isStaff: auth.isManager }) ? type : null
})

const isTestTicket = computed(() => isAdminOnlyType(ticketType.value))

const status = computed(() =>
  ticketType.value ? getTicketStatus(ticketType.value, now.value, soldOut.value) : null
)

const purchaseLimit = computed(() =>
  ticketType.value ? getPurchaseLimit(ticketType.value) : null
)

async function loadTicketTypes() {
  loading.value = true
  loadError.value = false

  try {
    ;[ticketTypes.value, soldOut.value] = await Promise.all([fetchTicketTypes(), fetchSoldOut()])
  } catch (error) {
    console.error('Load ticket types error:', error)
    loadError.value = true
    ticketTypes.value = []
    soldOut.value = {}
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  refreshPendingCheckout()
  loadTicketTypes()
})

/* ---------- inline order form ---------- */

const showOrderForm = ref(false)
const submitting = ref(false)
const BUSY_ERRORS = ['functions/aborted', 'functions/deadline-exceeded']
const orderError = ref('')
const orderForm = ref(null)
const validationAttempted = ref(false)
const pendingCheckout = ref(null)
const quantity = ref(1)
const acceptedTerms = ref(false)
const turnstile = ref(null)
const turnstileToken = ref('')
const buyer = ref({
  school: '',
  class: '',
  number: '',
  office: '',
  customerName: '',
  customerPhone: ''
})

// 本校學生 tickets can only be bought by 建國中學 students signed in with a
// school account (checked again by createOrder)
const isCampusTicket = computed(() =>
  ticketType.value?.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS
)

// 僅限建中及友校: a 建中 or 友校 school account, ordering as that school
// (checked again by createOrder); no 學生切結
const isFriendSchoolsTicket = computed(
  () => !isCampusTicket.value && isFriendSchoolsOnlyType(ticketType.value)
)

// 學生優先購買: until studentOnlyUntil only school accounts (edu.tw) may buy,
// then everyone (checked again by createOrder)
const studentOnlyUntil = computed(() => ticketType.value?.studentOnlyUntil || '')
const isStudentPhase = computed(
  () => !!studentOnlyUntil.value && now.value < parseDate(studentOnlyUntil.value)
)
// school accounts buying such a type confirm they are students (createOrder
// checks this too); their student ID is checked at pickup
const needsStudentConfirm = computed(() => !!studentOnlyUntil.value && auth.isEduAccount)
const studentConfirmed = ref(false)

// 學生身分切結書: a buyer without a usable school account may sign it to buy
// during 學生優先購買 instead (createOrder takes it as studentDeclared; the
// student ID is checked at pickup). Not a replacement for the school account.
const declarationOpen = ref(false)
const studentDeclared = ref(false)
const studentDeclaration = ref(null)
const usesDeclaration = computed(
  () =>
    studentDeclared.value &&
    isStudentPhase.value &&
    !isCampusTicket.value &&
    !isFriendSchoolsTicket.value &&
    !auth.isEduAccount
)
watch(() => [auth.user?.uid, ticketType.value?.id], () => {
  studentDeclared.value = false
  studentDeclaration.value = null
})

const needsOtherAccount = computed(
  () =>
    (isCampusTicket.value && !auth.isSchoolAccount) ||
    (isFriendSchoolsTicket.value && !auth.accountSchool) ||
    (!isCampusTicket.value && isStudentPhase.value && !auth.isEduAccount && !studentDeclared.value)
)

function agreeDeclaration(declaration) {
  studentDeclaration.value = declaration
  studentDeclared.value = true
  openOrderForm()
}

// 僅限建中及友校: only the school of the signed-in account
const schoolOptions = computed(() => {
  if (isCampusTicket.value) return [HOME_SCHOOL]
  if (isFriendSchoolsTicket.value) return auth.accountSchool ? [auth.accountSchool] : []
  return SCHOOLS
})

function goToLogin() {
  const account = isCampusTicket.value
    ? 'school'
    : isFriendSchoolsTicket.value
      ? 'friend'
      : isStudentPhase.value
        ? 'edu'
        : null
  router.push({
    name: 'login',
    query: { redirect: route.fullPath, ...(account ? { account } : {}) }
  })
}

async function switchAccount() {
  await auth.signOut()
  goToLogin()
}

const needsClass = computed(() => CAMPUS_SCHOOLS.includes(buyer.value.school))

const maxQuantity = computed(() =>
  Math.min(purchaseLimit.value || MAX_TICKETS_PER_ORDER, MAX_TICKETS_PER_ORDER)
)

const fieldErrors = computed(() => {
  const errors = {}
  if (!Number.isInteger(quantity.value) || quantity.value < 1 || quantity.value > maxQuantity.value) {
    errors.quantity = `請輸入 1 至 ${maxQuantity.value} 張的整數數量`
  }
  if (!schoolOptions.value.includes(buyer.value.school)) errors.school = '請選擇學校或身分'
  if (needsClass.value && !buyer.value.class.trim()) errors.class = '請填寫班級'
  if (needsClass.value && !buyer.value.number.trim()) errors.number = '請填寫座號'
  if (!buyer.value.customerName.trim()) errors.customerName = '請填寫購票人姓名'
  if (!buyer.value.customerPhone.trim()) errors.customerPhone = '請填寫聯絡電話'
  if (!acceptedTerms.value) errors.terms = '請閱讀並同意銷售與使用者條款'
  if (needsStudentConfirm.value && !studentConfirmed.value) errors.student = '請確認你是在學學生'
  return errors
})

function refreshPendingCheckout() {
  try {
    pendingCheckout.value = auth.user?.uid ? getPendingCheckout(auth.user.uid) : null
  } catch (error) {
    orderError.value = error.message || '無法確認上次訂單，請重新整理後再試。'
  }
}

watch(() => auth.user?.uid, refreshPendingCheckout)

function openOrderForm() {
  if (!ticketType.value || status.value.state !== 'selling') return
  if (!auth.isLoggedIn) return goToLogin()
  if (needsOtherAccount.value) return
  refreshPendingCheckout()
  if (pendingCheckout.value) return

  quantity.value = 1
  orderError.value = ''
  validationAttempted.value = false
  if (!schoolOptions.value.includes(buyer.value.school)) {
    buyer.value.school = schoolOptions.value.length === 1 ? schoolOptions.value[0] : ''
  }
  showOrderForm.value = true
}

function closeOrderForm() {
  showOrderForm.value = false
  orderError.value = ''
}

async function submitDirectOrder() {
  if (!ticketType.value || !auth.isLoggedIn || needsOtherAccount.value || submitting.value) return
  validationAttempted.value = true
  if (Object.keys(fieldErrors.value).length) {
    orderError.value = '請完成以下欄位後再送出訂單。'
    await nextTick()
    orderForm.value?.querySelector('[aria-invalid="true"]')?.focus()
    return
  }

  const { school, customerName, customerPhone } = buyer.value

  await sendOrder({
    school,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    class: needsClass.value ? buyer.value.class.trim() : '',
    number: needsClass.value ? buyer.value.number.trim() : '',
    office: school === '建中老師' ? buyer.value.office.trim() : '',
    ...(needsStudentConfirm.value ? { studentConfirmed: studentConfirmed.value } : {}),
    ...(usesDeclaration.value ? { studentDeclared: true, studentDeclaration: studentDeclaration.value } : {}),
    items: [{ id: ticketType.value.id, quantity: quantity.value }]
  })
}

async function retryPendingOrder() {
  if (submitting.value) return
  refreshPendingCheckout()
  if (pendingCheckout.value) await sendOrder(pendingCheckout.value.payload)
}

async function sendOrder(payload) {
  const uid = auth.user?.uid
  if (!uid || submitting.value) return
  if (TURNSTILE_SITE_KEY && !turnstileToken.value) {
    orderError.value = '請先完成人機驗證，再送出訂單。'
    return
  }
  submitting.value = true
  orderError.value = ''
  try {
    const result = await submitOrder(payload, { uid, turnstileToken: turnstileToken.value })
    if (auth.user?.uid !== uid) return

    showOrderForm.value = false
    toast.show(`訂單 #${result.id} 已送出。`)
    router.push({ name: 'order-success', query: { id: result.id } })
  } catch (error) {
    if (auth.user?.uid !== uid) return
    console.error('Submit order error:', error)
    // HttpsError messages from createOrder are already user-facing Chinese;
    // busy errors only reach here after the automatic retries also failed
    orderError.value = BUSY_ERRORS.includes(error?.code)
      ? '目前購票人數眾多，訂單尚未完成。請稍候幾秒再按上方「確認或重試原訂單」，同一筆訂單不會重複購買。'
      : error?.message && error.code !== 'functions/internal'
        ? error.message
        : '訂單送出失敗，請稍後再試。'
    // the token was used up by this attempt; solve a new one before retrying
    turnstile.value?.reset()
  } finally {
    refreshPendingCheckout()
    submitting.value = false
  }
}
</script>

<style scoped>
@import 'src/css/productpage.scss';
</style>
