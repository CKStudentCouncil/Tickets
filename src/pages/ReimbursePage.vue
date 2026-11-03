<template>
  <div class="seller-page officer-page reimburse-page">
    <header class="page-header">
      <div class="header-copy">
        <p class="eyebrow"><span /> CK PARTY NIGHT / REIMBURSEMENT</p>
        <h1>報帳申請</h1>
        <p class="header-intro">為舞會先墊付的錢在這裡申請報帳；總副召核准後撥款</p>
      </div>
      <div class="account-chip">
        <span class="account-dot" aria-hidden="true" />
        <span>{{ auth.email }}</span>
      </div>
    </header>

    <div v-if="!auth.isAdmin" class="empty-state">
      <h2>權限不足</h2>
      <p>報帳申請只開放給管理員</p>
    </div>

    <div v-else-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試</p>
      <button type="button" class="primary-button" @click="load">重新載入</button>
    </div>

    <template v-else>
      <div class="action-grid">
        <section class="card registration-card" aria-labelledby="form-title">
          <div class="card-heading">
            <p class="section-label">01 / NEW CLAIM</p>
            <span class="card-index">01</span>
          </div>
          <h2 id="form-title">申請報帳</h2>

          <div v-if="lastClaim" class="new-link" role="status">
            <p class="new-link-label">已送出・待審核</p>
            <p class="claim-summary">
              {{ lastClaim.name }}・NT$ <span class="num">{{ lastClaim.amount.toLocaleString() }}</span>
            </p>
            <p class="muted">
              <span class="num">{{ lastClaim.invoiceCount }}</span> 個發票檔案已存到班聯會的雲端硬碟；總副召核准後撥款
            </p>
            <div class="row-actions">
              <button ref="nextButton" type="button" class="primary-button" @click="lastClaim = null">
                <span>再申請一筆</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>

          <form v-else class="register-form" @submit.prevent="submit">
            <label class="field">
              <span>姓名 <small>花錢的人，撥款給這位</small></span>
              <input
                v-model="form.name"
                type="text"
                autocomplete="name"
                :maxlength="MAX_REIMBURSER_NAME"
                required
                :disabled="submitting"
              >
            </label>

            <label class="field">
              <span>花費金額（NT$） <small>整數，最多 {{ MAX_REIMBURSEMENT_AMOUNT.toLocaleString() }}</small></span>
              <input
                v-model.number="form.amount"
                type="number"
                inputmode="numeric"
                min="1"
                :max="MAX_REIMBURSEMENT_AMOUNT"
                step="1"
                placeholder="0"
                required
                :aria-invalid="!!amountError"
                aria-describedby="amount-error"
                :disabled="submitting"
              >
              <em v-if="amountError" id="amount-error" class="field-error">{{ amountError }}</em>
            </label>

            <label class="field">
              <span>科目 <small>花在哪一類，總副召可以再調整</small></span>
              <select v-model="form.category" required :disabled="submitting">
                <option value="" disabled>請選擇科目</option>
                <option v-for="category in REIMBURSEMENT_CATEGORIES" :key="category" :value="category">{{ category }}</option>
              </select>
            </label>

            <div class="field">
              <span id="invoice-label">發票或收據 <small>必填，最多 {{ MAX_INVOICE_FILES }} 個，可直接拍照</small></span>
              <ul v-if="invoices.length" class="invoice-list" aria-labelledby="invoice-label">
                <li v-for="item in invoices" :key="item.key">
                  <img v-if="item.previewUrl" :src="item.previewUrl" alt="" class="invoice-thumb">
                  <span v-else class="invoice-thumb invoice-pdf" aria-hidden="true">PDF</span>
                  <span class="invoice-name">{{ item.name }}</span>
                  <span class="invoice-size num">{{ formatFileSize(item.size) }}</span>
                  <button
                    type="button"
                    class="invoice-remove"
                    :aria-label="`移除 ${item.name}`"
                    :disabled="submitting"
                    @click="removeInvoice(item)"
                  >
                    <X :size="16" :stroke-width="1.75" aria-hidden="true" />
                  </button>
                </li>
              </ul>
              <label
                v-if="invoices.length < MAX_INVOICE_FILES"
                class="invoice-picker"
                :class="{ disabled: submitting || preparing }"
              >
                <input
                  type="file"
                  :accept="INVOICE_ACCEPT"
                  multiple
                  aria-describedby="invoice-error"
                  :disabled="submitting || preparing"
                  @change="addInvoices"
                >
                <Camera :size="18" :stroke-width="1.75" aria-hidden="true" />
                <span>{{ preparing ? '處理中…' : invoices.length ? '再加一張' : '拍照或選擇檔案' }}</span>
              </label>
              <em v-if="invoiceError" id="invoice-error" class="field-error" role="alert">{{ invoiceError }}</em>
            </div>

            <label class="field">
              <span>用途 <small>選填</small></span>
              <textarea
                v-model="form.note"
                rows="3"
                :maxlength="MAX_REIMBURSEMENT_NOTE"
                placeholder="例：場佈材料、工作人員餐點"
                :disabled="submitting"
              />
            </label>

            <p class="amount-due">
              <span>申請金額</span>
              <strong class="num">NT$ {{ validAmount ? form.amount.toLocaleString() : 0 }}</strong>
            </p>

            <p class="warning"><span aria-hidden="true">!</span> 發票會存到班聯會（{{ INVOICE_DRIVE_OWNER }}）的雲端硬碟；核准後才會撥款</p>

            <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>

            <button type="submit" class="primary-button" :disabled="submitting || preparing || !valid">
              <span>{{ submitting ? '上傳中…' : '送出報帳' }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>

        <section class="card guide-card" aria-labelledby="guide-title">
          <div class="card-heading">
            <p class="section-label">02 / HOW IT WORKS</p>
            <span class="card-index">02</span>
          </div>
          <h2 id="guide-title">怎麼報帳</h2>
          <ol class="steps">
            <li v-for="(step, index) in REIMBURSE_STEPS" :key="step"><span>0{{ index + 1 }}</span>{{ step }}</li>
          </ol>
          <p class="muted guide-note">被退回的報帳不會撥款，有問題請找總副召</p>
        </section>
      </div>

      <section class="card" aria-labelledby="history-title">
        <div class="card-heading">
          <p class="section-label">03 / YOUR CLAIMS</p>
          <span class="card-index">03</span>
        </div>
        <h2 id="history-title">我的報帳</h2>

        <p v-if="claims.length === 0" class="muted">還沒有報帳紀錄</p>
        <template v-else>
          <dl class="claim-totals">
            <div><dt>待審核</dt><dd class="num">NT$ {{ totals.amounts.pending.toLocaleString() }}</dd></div>
            <div><dt>待撥款</dt><dd class="num">NT$ {{ totals.owed.toLocaleString() }}</dd></div>
            <div><dt>已撥款</dt><dd class="num">NT$ {{ totals.amounts.paid.toLocaleString() }}</dd></div>
          </dl>

          <ul class="history">
            <li v-for="claim in claims" :key="claim.id">
              <div class="history-copy">
                <p class="history-main">
                  {{ claim.name }}・NT$ <span class="num">{{ claimAmount(claim).toLocaleString() }}</span><template v-if="claim.category">・{{ claim.category }}</template>
                </p>
                <p v-if="claim.note" class="muted claim-note">{{ claim.note }}</p>
                <p class="muted num">
                  {{ formatDateTime(claim.createdAt) }}<template v-if="claim.invoices?.length">・發票 {{ claim.invoices.length }} 個</template>
                </p>
              </div>
              <div class="badges">
                <span class="badge" :class="`status-${claim.status}`">{{ REIMBURSEMENT_STATUS_LABELS[claim.status] || claim.status }}</span>
                <button
                  v-if="claim.status === 'pending'"
                  type="button"
                  class="secondary-button danger"
                  :disabled="busyIds.has(claim.id)"
                  @click="withdraw(claim)"
                >
                  撤回
                </button>
              </div>
            </li>
          </ul>
        </template>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Camera, X } from 'lucide-vue-next'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import {
  INVOICE_ACCEPT,
  INVOICE_DRIVE_OWNER,
  MAX_INVOICE_BYTES,
  MAX_INVOICE_FILES,
  MAX_REIMBURSEMENT_AMOUNT,
  MAX_REIMBURSEMENT_NOTE,
  MAX_REIMBURSER_NAME,
  REIMBURSE_STEPS,
  REIMBURSEMENT_CATEGORIES,
  REIMBURSEMENT_STATUS_LABELS
} from 'src/data/reimbursements'
import { deleteReimbursement, fetchMyReimbursements, submitReimbursement } from 'src/services/reimbursementService'
import { createRequestId } from 'src/services/orderService'
import { claimAmount, summarizeReimbursements } from 'src/utils/reimbursements'
import { InvoiceFileError, blobToBase64, formatFileSize, prepareInvoiceFile } from 'src/utils/invoiceFiles'
import { formatDateTime } from 'src/utils/datetime'

const auth = useAuthStore()
const toast = useToastStore()

// the name on the staff profile to start with; the next claim keeps the last one typed
const emptyForm = (name = auth.user?.name || '') => ({ name, amount: '', note: '', category: '' })

const loading = ref(true)
const loadError = ref(false)
const claims = ref([])

const form = ref(emptyForm())
const submitting = ref(false)
const submitError = ref('')
// the claim just sent, shown until the next one starts
const lastClaim = ref(null)
const nextButton = ref(null)
// claims with a withdrawal in flight
const busyIds = reactive(new Set())

// the invoices picked so far, photos already shrunk (src/utils/invoiceFiles.js)
const invoices = ref([])
const preparing = ref(false)
const invoiceError = ref('')
let invoiceKey = 0

const invoiceBytes = computed(() => invoices.value.reduce((total, item) => total + item.size, 0))

const validName = computed(() => form.value.name.trim().length > 0)
const validAmount = computed(() =>
  Number.isInteger(form.value.amount) && form.value.amount >= 1 && form.value.amount <= MAX_REIMBURSEMENT_AMOUNT
)
const valid = computed(() =>
  validName.value && validAmount.value && REIMBURSEMENT_CATEGORIES.includes(form.value.category) &&
  invoices.value.length > 0 && invoiceBytes.value <= MAX_INVOICE_BYTES
)
// nothing typed yet is not an error
const amountError = computed(() => {
  if (form.value.amount === '' || validAmount.value) return ''
  return form.value.amount > MAX_REIMBURSEMENT_AMOUNT
    ? `單筆最多 NT$ ${MAX_REIMBURSEMENT_AMOUNT.toLocaleString()}`
    : '請輸入大於 0 的整數金額'
})

const totals = computed(() => summarizeReimbursements(claims.value))

// The claim whose outcome is unknown (the response was lost): sending it
// again unchanged reuses its requestId, so submitReimbursement returns it
// instead of filing it twice. Any change makes it another claim.
let pendingRequestId = null

watch([form, invoices], () => {
  submitError.value = ''
  pendingRequestId = null
}, { deep: true })

async function addInvoices(event) {
  const picked = [...(event.target.files || [])]
  // the same file can be picked again after it was removed
  event.target.value = ''
  if (!picked.length) return

  invoiceError.value = ''
  const room = MAX_INVOICE_FILES - invoices.value.length
  if (picked.length > room) invoiceError.value = `最多 ${MAX_INVOICE_FILES} 個檔案，多的沒有加入`

  preparing.value = true
  try {
    for (const file of picked.slice(0, room)) {
      try {
        invoices.value.push({ key: ++invoiceKey, ...(await prepareInvoiceFile(file)) })
      } catch (error) {
        if (!(error instanceof InvoiceFileError)) console.error('Prepare invoice error:', error)
        invoiceError.value = error instanceof InvoiceFileError ? error.message : `無法處理「${file.name}」，請換一個檔案`
      }
    }
    if (invoiceBytes.value > MAX_INVOICE_BYTES) {
      invoiceError.value = `檔案合計超過 ${formatFileSize(MAX_INVOICE_BYTES)}，請移除一些或改用較小的 PDF`
    }
  } finally {
    preparing.value = false
  }
}

function removeInvoice(item) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  invoices.value = invoices.value.filter((other) => other.key !== item.key)
  invoiceError.value = invoiceBytes.value > MAX_INVOICE_BYTES
    ? `檔案合計超過 ${formatFileSize(MAX_INVOICE_BYTES)}，請移除一些或改用較小的 PDF`
    : ''
}

function clearInvoices() {
  invoices.value.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
  invoices.value = []
  invoiceError.value = ''
}

async function load() {
  loadError.value = false
  try {
    claims.value = await fetchMyReimbursements(auth.user.uid)
  } catch (error) {
    console.error('Load reimbursements error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// definite refusals, explained by the server's message (not an admin, bad
// input, the Drive grant no longer works); nothing was saved
const REFUSALS = ['functions/permission-denied', 'functions/invalid-argument', 'functions/failed-precondition']

async function submit() {
  if (!valid.value || submitting.value || preparing.value) return

  const claim = {
    name: form.value.name.trim(),
    amount: form.value.amount,
    note: form.value.note.trim(),
    category: form.value.category
  }
  const count = invoices.value.length
  if (!window.confirm(`確定要以「${claim.name}」申請報帳 NT$ ${claim.amount.toLocaleString()}，附 ${count} 個發票檔案嗎？`)) return

  submitting.value = true
  submitError.value = ''
  pendingRequestId ||= createRequestId()

  try {
    const files = await Promise.all(invoices.value.map(async (item) => ({
      name: item.name,
      contentType: item.contentType,
      data: await blobToBase64(item.blob)
    })))
    await submitReimbursement({ ...claim, requestId: pendingRequestId, invoices: files })
    lastClaim.value = { ...claim, invoiceCount: count }
    form.value = emptyForm(claim.name)
    clearInvoices()
    // after the watch above has run for these changes
    await nextTick()
    pendingRequestId = null
    toast.show('報帳已送出，等待審核')
    await load()
    await nextTick()
    nextButton.value?.focus({ preventScroll: true })
  } catch (error) {
    console.error('Submit reimbursement error:', error)
    if (REFUSALS.includes(error?.code)) {
      pendingRequestId = null
      submitError.value = error.message
    } else {
      submitError.value = '送出結果不明，請先看下方「我的報帳」；沒有這筆再按一次（不會重複報帳）'
      await load()
    }
  } finally {
    submitting.value = false
  }
}

async function withdraw(claim) {
  if (!window.confirm(`確定要撤回「${claim.name}」的報帳 NT$ ${claimAmount(claim).toLocaleString()} 嗎？`)) return

  busyIds.add(claim.id)
  try {
    await deleteReimbursement(claim.id)
    claims.value = claims.value.filter((item) => item.id !== claim.id)
    toast.show('已撤回')
  } catch (error) {
    console.error('Withdraw reimbursement error:', error)
    // a super admin may have reviewed it in the meantime
    toast.show('撤回失敗，可能已經審核過了')
    await load()
  } finally {
    busyIds.delete(claim.id)
  }
}

onMounted(() => {
  if (auth.isAdmin) load()
  else loading.value = false
})

onBeforeUnmount(clearInvoices)
</script>

<style scoped>
@import 'src/css/sellerpage.scss';
@import 'src/css/officerpage.scss';
@import 'src/css/reimbursepage.scss';
</style>
