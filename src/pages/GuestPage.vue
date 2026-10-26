<template>
  <div class="guest-page">
    <header class="page-header">
      <p class="eyebrow"><span /> CK PARTY NIGHT / GUEST LIST</p>
      <h1>公關票<em>登記</em></h1>
      <p class="header-intro">受邀的親友與大學長，請填妥您的資訊，
        經確認後，公關票會寄到你的 Email</p>
    </header>

    <div v-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試</p>
      <button type="button" class="primary-button" @click="load">重新載入</button>
    </div>

    <div v-else class="guest-layout">
      <!-- the invitation as it will read: what the council sees and the email prints -->
      <section class="stub" :class="stage" aria-label="公關票預覽">
        <div class="stub-head">
          <p class="stub-kind">COSMOS <span>公關票</span></p>
          <span class="stage-pill"><span aria-hidden="true" />{{ STAGE_LABELS[stage] }}</span>
        </div>
        <p class="stub-name" :class="{ empty: !shownName }">{{ shownName || '你的姓名' }}</p>
        <p class="stub-relation" :class="{ empty: !shownRelation }">{{ shownRelation || '身分' }}</p>
        <p class="stub-email">{{ auth.email }}</p>
        <div class="stub-tear" aria-hidden="true" />
        <dl class="stub-event">
          <div>
            <dt>DATE</dt>
            <dd><time :datetime="EVENT_DATE.replaceAll('/', '-')">{{ EVENT_DATE.replaceAll('/', '.') }}</time></dd>
          </div>
          <div>
            <dt>VENUE</dt>
            <dd>{{ EVENT_VENUE }}</dd>
          </div>
        </dl>
      </section>

      <div class="guest-main">
        <section v-if="invited" class="status-card" aria-labelledby="status-title">
          <h2 id="status-title">公關票已寄出</h2>
          <p class="muted">
            已寄到 <strong class="email">{{ registration.email }}</strong>，請到信箱查看（也可能在垃圾郵件匣）；請依信中說明出示 QR Code 兌換紙本票券
          </p>
        </section>

        <section v-else-if="registration && !editing" class="status-card" aria-labelledby="status-title">
          <h2 id="status-title">已收到登記</h2>
          <p class="muted">
            已於 <span class="num">{{ formatDateTime(registration.createdAt) }}</span> 收到；班聯會確認後會把公關票寄到 <strong class="email">{{ registration.email }}</strong>，寄出前都可以修改
          </p>
          <button type="button" class="secondary-button" @click="startEditing">修改登記資料</button>
        </section>

        <form v-else class="guest-form" aria-labelledby="form-title" @submit.prevent="submit">
          <h2 id="form-title">{{ registration ? '修改登記資料' : '填寫資料' }}</h2>

          <label class="field">
            <span>姓名</span>
            <input
              ref="nameInput"
              v-model="name"
              type="text"
              maxlength="50"
              autocomplete="name"
              aria-describedby="name-hint"
              required
            >
            <small id="name-hint" class="hint">務必填寫本名，入場時將查驗身分</small>
          </label>

          <div class="field">
            <span>Email</span>
            <p class="readonly-value">{{ auth.email }}</p>
            <small class="hint">公關票會寄到你登入的 Google 帳號；要改用其他 Email，請登出後用那個帳號登入</small>
          </div>

          <fieldset class="field">
            <legend>身分</legend>
            <div class="choices">
              <label
                v-for="option in GUEST_RELATIONS"
                :key="option.value"
                class="choice"
                :class="{ on: relation === option.value }"
              >
                <input v-model="relation" type="radio" name="relation" :value="option.value" required>
                <span>{{ option.label }}</span>
              </label>
            </div>
          </fieldset>

          <label v-if="relationOption" class="field">
            <span>{{ relationOption.detail }}</span>
            <input
              v-model="relationDetail"
              type="text"
              maxlength="50"
              :placeholder="relationOption.placeholder"
              required
            >
          </label>

          <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>

          <div class="form-actions">
            <button type="submit" class="primary-button" :disabled="submitting || !canSubmit">
              <span>{{ submitting ? '送出中…' : registration ? '更新登記' : '送出登記' }}</span>
              <span aria-hidden="true">→</span>
            </button>
            <button v-if="registration" type="button" class="secondary-button" :disabled="submitting" @click="stopEditing">
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { EVENT_DATE, EVENT_VENUE } from 'src/config/app'
import { GUEST_RELATIONS, guestRelationText } from 'src/data/guests'
import { fetchMyGuestRegistration, saveGuestRegistration } from 'src/services/guestService'
import { formatDateTime } from 'src/utils/datetime'

const auth = useAuthStore()
const toast = useToastStore()

const STAGE_LABELS = { new: '尚未登記', waiting: '等待寄送', sent: '已寄出' }

const loading = ref(true)
const loadError = ref(false)
// guestRegistrations/{uid}, or null before the guest registers
const registration = ref(null)

const name = ref('')
const relation = ref('')
const relationDetail = ref('')
// a registered guest sees the status first and opens the form to change it
const editing = ref(false)
const nameInput = ref(null)
const submitting = ref(false)
const submitError = ref('')

const relationOption = computed(() => GUEST_RELATIONS.find((option) => option.value === relation.value) || null)
// sendGuestInvitation records the ticket it sent; the rules then allow no changes
const invited = computed(() => Boolean(registration.value?.orderId))
const stage = computed(() => (invited.value ? 'sent' : registration.value ? 'waiting' : 'new'))
const canSubmit = computed(
  () => name.value.trim() !== '' && relationOption.value !== null && relationDetail.value.trim() !== ''
)

// the stub follows the form, so the guest sees how they will be listed
const shownName = computed(() => name.value.trim())
const shownRelation = computed(() =>
  guestRelationText({ relation: relation.value, relationDetail: relationDetail.value })
)

// a class typed for 校友 is not whose friend they are
watch(relation, (value, previous) => {
  if (previous) relationDetail.value = ''
})

function fillForm(data) {
  name.value = data?.name || auth.user?.displayName || ''
  relation.value = data?.relation || ''
  relationDetail.value = data?.relationDetail || ''
}

async function load() {
  loading.value = true
  loadError.value = false

  try {
    const data = await fetchMyGuestRegistration(auth.user.uid)
    registration.value = data
    fillForm(data)
  } catch (error) {
    console.error('Load guest registration error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function startEditing() {
  editing.value = true
  await nextTick()
  nameInput.value?.focus()
}

// back to the saved details
async function stopEditing() {
  fillForm(registration.value)
  // the relation watcher clears the detail; put it back after it runs
  await nextTick()
  relationDetail.value = registration.value?.relationDetail || ''
  submitError.value = ''
  editing.value = false
}

async function submit() {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  submitError.value = ''
  const uid = auth.user.uid
  const changing = registration.value !== null

  try {
    await saveGuestRegistration(
      uid,
      {
        name: name.value.trim(),
        email: auth.email.toLowerCase(),
        relation: relation.value,
        relationDetail: relationDetail.value.trim()
      },
      registration.value?.createdAt
    )
    registration.value = await fetchMyGuestRegistration(uid)
    editing.value = false
    toast.show(changing ? '已更新登記資料' : '已收到登記，公關票寄出後會寄到你的 Email', 6000)
  } catch (error) {
    console.error('Save guest registration error:', error)
    if (error?.code === 'permission-denied') {
      // the ticket was sent, or the registration removed, meanwhile; the
      // form keeps what the guest typed
      registration.value = await fetchMyGuestRegistration(uid).catch(() => registration.value)
      if (!invited.value) submitError.value = '登記狀態已變更，請確認資料後再送出一次'
    } else {
      submitError.value = '送出失敗，請稍後再試'
    }
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
@import 'src/css/guestpage.scss';
</style>
