<template>
  <div class="admin-page">
    <div class="page-heading">
      <br />
      <p class="eyebrow">後台管理</p>
      <h1>公關票</h1>
      <p class="page-intro">
        幫幹部設定公關票額度，幹部在自己的頁面直接寄票或產生邀請連結；也能用登記連結讓一群人登記，審核後再寄出；每張公關票附 QR Code 的邀請信約一分鐘內寄出，不佔票券庫存、不會收到繳費通知
      </p>
    </div>

    <p v-if="loading" class="empty">載入中...</p>

    <div v-else-if="loadError" class="panel">
      <p class="empty">資料載入失敗，請檢查網路後重試</p>
      <button type="button" class="btn" @click="load()">重新載入</button>
    </div>

    <template v-else>
      <section class="panel" aria-labelledby="officers-title">
        <div class="notify-header">
          <h2 id="officers-title">幹部額度</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn-outline" :disabled="refreshing" @click="load(false)">
              {{ refreshing ? '更新中...' : '重新整理' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">
          幹部用這裡填的 Google 帳號登入，就能在「發公關票」頁面用自己的額度發票；產生邀請連結時會先扣額度，撤銷未領取的連結或刪除公關票會退回
        </p>

        <div class="share-link">
          <span class="mono">{{ OFFICER_PAGE_URL }}</span>
          <button type="button" class="btn-outline" @click="copyText(OFFICER_PAGE_URL, '已複製幹部頁面連結')">複製幹部頁面連結</button>
        </div>

        <p class="ledger-summary">
          <span><strong class="num">{{ officers.length }}</strong> 位幹部</span>
          <span>總額度 <strong class="num">{{ quotaTotal }}</strong> 張</span>
          <span>已使用 <strong class="num">{{ usedTotal }}</strong> 張</span>
          <span>連結保留 <strong class="num">{{ heldTotal }}</strong> 張</span>
        </p>

        <form class="send-form officer-form" @submit.prevent="submitOfficer">
          <div class="form-grid">
            <label class="field">
              <span>Email（Google 帳號）</span>
              <input v-model="newOfficer.email" type="email" maxlength="254" autocomplete="off" :disabled="adding" required>
            </label>
            <label class="field">
              <span>姓名</span>
              <input v-model="newOfficer.name" type="text" maxlength="50" autocomplete="off" :disabled="adding" required>
            </label>
            <label class="field">
              <span>額度（張）</span>
              <input
                v-model.number="newOfficer.quota"
                type="number"
                inputmode="numeric"
                min="0"
                :max="MAX_OFFICER_QUOTA"
                step="1"
                :disabled="adding"
                required
              >
            </label>
          </div>
          <p v-if="officerTaken" class="warning">這個 Email 已經在名單中，請直接修改它的額度</p>
          <p v-if="addError" class="error" role="alert">{{ addError }}</p>
          <button type="submit" class="btn" :disabled="adding || !newOfficerValid">
            {{ adding ? '新增中...' : '新增幹部' }}
          </button>
        </form>

        <input
          v-if="officers.length > 5"
          v-model="officerSearch"
          type="search"
          class="search"
          aria-label="搜尋幹部"
          placeholder="搜尋姓名或 Email"
        >

        <p v-if="officers.length === 0" class="empty">還沒有幹部；新增後他們就能發公關票</p>
        <p v-else-if="shownOfficers.length === 0" class="empty">沒有符合的幹部</p>
        <ul v-else class="guest-list">
          <li
            v-for="item in shownOfficers"
            :key="item.id"
            class="guest-row"
            :class="{ open: editingId === item.id }"
          >
            <div class="guest-who">
              <p class="guest-name">{{ item.name || '（未填姓名）' }}</p>
              <p class="guest-email mono">{{ item.email }}</p>
            </div>
            <p class="guest-time quota-line">
              已用 <strong class="num">{{ item.used || 0 }}</strong> / <span class="num">{{ item.quota }}</span> 張
              <span v-if="heldBy(item.email)" class="held">（連結保留 <span class="num">{{ heldBy(item.email) }}</span>）</span>
              <br>剩 <strong class="num">{{ remainingOf(item) }}</strong> 張
            </p>
            <div class="guest-actions">
              <button
                type="button"
                class="btn"
                :aria-expanded="editingId === item.id"
                :aria-controls="`edit-${item.id}`"
                :disabled="busyIds.has(item.id)"
                @click="toggleEdit(item)"
              >
                修改
              </button>
              <button
                type="button"
                class="btn-outline danger"
                :disabled="busyIds.has(item.id)"
                @click="removeOfficer(item)"
              >
                刪除
              </button>
            </div>

            <form v-if="editingId === item.id" :id="`edit-${item.id}`" class="send-step" @submit.prevent="saveOfficer(item)">
              <div class="form-grid">
                <label class="field">
                  <span>姓名</span>
                  <input v-model="editForm.name" type="text" maxlength="50" :disabled="busyIds.has(item.id)" required>
                </label>
                <label class="field">
                  <span>額度（張，至少 {{ item.used || 0 }}）</span>
                  <input
                    v-model.number="editForm.quota"
                    type="number"
                    inputmode="numeric"
                    :min="item.used || 0"
                    :max="MAX_OFFICER_QUOTA"
                    step="1"
                    :disabled="busyIds.has(item.id)"
                    required
                  >
                </label>
              </div>
              <p v-if="editError" class="error" role="alert">{{ editError }}</p>
              <div class="send-step-actions">
                <button type="submit" class="btn" :disabled="busyIds.has(item.id) || !editValid(item)">
                  {{ busyIds.has(item.id) ? '儲存中...' : '儲存' }}
                </button>
                <button type="button" class="btn-outline" :disabled="busyIds.has(item.id)" @click="editingId = null">取消</button>
              </div>
            </form>
          </li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="direct-title">
        <div class="notify-header">
          <h2 id="direct-title">直接寄送</h2>
          <div class="ticket-type-header-actions">
            <button
              type="button"
              class="btn-outline"
              :aria-expanded="directOpen"
              aria-controls="direct-form"
              @click="directOpen = !directOpen"
            >
              {{ directOpen ? '收起' : '填寫收件人' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">以班聯會名義寄出，不佔任何幹部的額度：填好姓名與 Email，確認後寄出</p>

        <form v-if="directOpen" id="direct-form" class="send-form" @submit.prevent="reviewDirect">
          <div class="form-grid">
            <label class="field">
              <span>姓名</span>
              <input v-model="form.name" type="text" maxlength="50" :disabled="directReview" required>
            </label>
            <label class="field">
              <span>Email</span>
              <input
                v-model="form.email"
                type="email"
                maxlength="254"
                autocomplete="off"
                :disabled="directReview"
                required
              >
            </label>
            <div class="field">
              <span>張數</span>
              <QuantityStepper v-model="form.quantity" :max="MAX_GUEST_TICKETS" :disabled="directReview" />
            </div>
          </div>

          <p v-if="earlierTicket" class="warning">
            這個 Email 已經收過公關票（<span class="mono">{{ earlierTicket.id }}</span>），再寄會多一筆
          </p>
          <p v-if="directError" class="error" role="alert">{{ directError }}</p>

          <div v-if="directReview" class="review" role="status">
            <p>
              寄出 <strong class="num">{{ form.quantity }}</strong> 張公關票給 <strong>{{ form.name.trim() }}</strong>
              （<span class="mono">{{ form.email.trim().toLowerCase() }}</span>）
            </p>
            <div class="send-step-actions">
              <button type="button" class="btn" :disabled="sending" @click="sendDirect">
                {{ sending ? '寄送中...' : '確認寄出' }}
              </button>
              <button type="button" class="btn-outline" :disabled="sending" @click="directReview = false">返回修改</button>
            </div>
          </div>
          <button v-else type="submit" class="btn" :disabled="sending || !formValid">寄送公關票</button>
        </form>
      </section>

      <section class="panel" aria-labelledby="links-title">
        <div class="notify-header">
          <h2 id="links-title">邀請連結</h2>
        </div>
        <p class="panel-copy">
          以班聯會名義產生一次性連結，不佔任何幹部的額度：對方用 Google 帳號登入、填上姓名就能領票。備註只有幹部本人和總管理看得到
        </p>

        <div v-if="createdInvite" class="new-link" role="status">
          <p class="new-link-label">
            新的連結・<span class="num">{{ createdInvite.quantity }}</span> 張<template v-if="createdInvite.note">・{{ createdInvite.note }}</template>
          </p>
          <div class="share-link">
            <span class="mono">{{ inviteUrl(createdInvite.id) }}</span>
            <button type="button" class="btn" @click="copyText(inviteUrl(createdInvite.id), '已複製連結')">複製連結</button>
            <button type="button" class="btn-outline" @click="createdInvite = null">完成</button>
          </div>
        </div>

        <form v-else class="send-form" @submit.prevent="createInvite">
          <div class="form-grid">
            <div class="field">
              <span>張數</span>
              <QuantityStepper v-model="inviteQuantity" :max="MAX_GUEST_TICKETS" :disabled="creating" />
            </div>
            <label class="field">
              <span>備註</span>
              <input
                v-model="inviteNote"
                type="text"
                :maxlength="MAX_INVITE_NOTE"
                autocomplete="off"
                placeholder="例：給校友會會長"
                :disabled="creating"
              >
            </label>
          </div>
          <p v-if="inviteError" class="error" role="alert">{{ inviteError }}</p>
          <button type="submit" class="btn" :disabled="creating || !validInviteQuantity">
            {{ creating ? '產生中...' : '產生邀請連結' }}
          </button>
        </form>

        <h3 class="sub-heading">還沒被領取的連結 <span class="num">{{ openInvites.length }}</span></h3>
        <p v-if="openInvites.length === 0" class="empty">沒有未領取的連結</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>產生者</th>
                <th>張數</th>
                <th>備註</th>
                <th>產生時間</th>
                <th>連結</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="invite in openInvites" :key="invite.id">
                <td class="strong">{{ invite.officerEmail ? invite.officerName || invite.officerEmail : '班聯會' }}</td>
                <td class="num">{{ invite.quantity }}</td>
                <td class="note-cell">{{ notes[invite.id] || '—' }}</td>
                <td class="num">{{ formatDateTime(invite.createdAt) }}</td>
                <td>
                  <button type="button" class="btn-outline btn-small" @click="copyText(inviteUrl(invite.id), '已複製連結')">複製</button>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn-outline btn-small danger"
                    :disabled="revokingIds.has(invite.id)"
                    @click="revoke(invite)"
                  >
                    {{ revokingIds.has(invite.id) ? '撤銷中...' : '撤銷' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" aria-labelledby="signup-links-title">
        <div class="notify-header">
          <h2 id="signup-links-title">登記連結</h2>
        </div>
        <p class="panel-copy">
          產生一條可以分享給一群人的連結：每個人用 Google 帳號登入、填上姓名登記，在下方「登記審核」核准後再寄出公關票；以班聯會名義寄出，不佔任何幹部的額度
        </p>

        <div v-if="createdSignupLink" class="new-link" role="status">
          <p class="new-link-label">
            新的登記連結・{{ createdSignupLink.title }}・每人 <span class="num">{{ createdSignupLink.quantity }}</span> 張
          </p>
          <div class="share-link">
            <span class="mono">{{ signupUrl(createdSignupLink.id) }}</span>
            <button type="button" class="btn" @click="copyText(signupUrl(createdSignupLink.id), '已複製登記連結')">複製連結</button>
            <button type="button" class="btn-outline" @click="createdSignupLink = null">完成</button>
          </div>
        </div>

        <form v-else class="send-form" @submit.prevent="createSignup">
          <div class="form-grid">
            <label class="field">
              <span>名稱（登記的人會看到）</span>
              <input
                v-model="signupTitle"
                type="text"
                :maxlength="MAX_SIGNUP_TITLE"
                autocomplete="off"
                placeholder="例：歷屆大學長"
                :disabled="creatingSignup"
                required
              >
            </label>
            <div class="field">
              <span>每人張數</span>
              <QuantityStepper v-model="signupQuantity" :max="MAX_GUEST_TICKETS" :disabled="creatingSignup" />
            </div>
          </div>
          <p v-if="signupLinkError" class="error" role="alert">{{ signupLinkError }}</p>
          <button type="submit" class="btn" :disabled="creatingSignup || !signupLinkValid">
            {{ creatingSignup ? '產生中...' : '產生登記連結' }}
          </button>
        </form>

        <h3 class="sub-heading">所有登記連結 <span class="num">{{ signupLinks.length }}</span></h3>
        <p v-if="signupLinks.length === 0" class="empty">還沒有登記連結</p>
        <div v-else class="table-wrap">
          <table class="signup-table">
            <thead>
              <tr>
                <th>名稱</th>
                <th>每人</th>
                <th>登記</th>
                <th>狀態</th>
                <th>產生時間</th>
                <th>連結</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in signupLinks" :key="item.id">
                <td class="strong note-cell">{{ item.title }}</td>
                <td><span class="num">{{ item.quantity }}</span> 張</td>
                <td>
                  <span class="num">{{ signupsOf(item.id).length }}</span> 人<span v-if="pendingOf(item.id)" class="pending-count">・待審核 <span class="num">{{ pendingOf(item.id) }}</span></span>
                </td>
                <td>
                  <span class="status" :class="{ on: item.open }">{{ item.open ? '登記中' : '已停止' }}</span>
                </td>
                <td class="num">{{ formatDateTime(item.createdAt) }}</td>
                <td>
                  <button type="button" class="btn-outline btn-small" @click="copyText(signupUrl(item.id), '已複製登記連結')">複製</button>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn-outline btn-small"
                    :disabled="linkBusyIds.has(item.id)"
                    @click="toggleSignupLink(item)"
                  >
                    {{ item.open ? '停止登記' : '重新開放' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" aria-labelledby="signups-title">
        <div class="notify-header">
          <h2 id="signups-title">登記審核</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn-outline" :disabled="refreshing" @click="load(false)">
              {{ refreshing ? '更新中...' : '重新整理' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">
          逐一核准或不通過登記的人；按「寄出公關票」後，邀請信約一分鐘內寄到他們登入的 Email；寄出前都可以改變審核結果
        </p>

        <p class="ledger-summary">
          <span v-for="(label, key) in SIGNUP_STATUS" :key="key">{{ label }} <strong class="num">{{ signupCounts[key] }}</strong></span>
        </p>

        <div class="signup-filters">
          <label class="field source-filter">
            <span>登記連結</span>
            <select v-model="signupLinkFilter" class="select-field">
              <option value="">全部</option>
              <option v-for="item in signupLinks" :key="item.id" :value="item.id">{{ item.title }}</option>
            </select>
          </label>
          <label class="field source-filter">
            <span>狀態</span>
            <select v-model="signupStatusFilter" class="select-field">
              <option value="">全部</option>
              <option v-for="(label, key) in SIGNUP_STATUS" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
        </div>

        <div v-if="linkPending.length || linkApproved.length || sendProgress" class="signup-batch">
          <button
            v-if="linkPending.length"
            type="button"
            class="btn-outline"
            :disabled="batchBusy"
            @click="approveAll"
          >
            {{ approvingAll ? '核准中...' : `核准全部待審核（${linkPending.length} 位）` }}
          </button>
          <button
            v-if="linkApproved.length || sendProgress"
            type="button"
            class="btn"
            :disabled="batchBusy"
            @click="sendApproved"
          >
            {{ sendProgress ? `寄出中 ${sendProgress.done}/${sendProgress.total}...` : `寄出公關票（${linkApproved.length} 位已核准，共 ${ticketsFor(linkApproved)} 張）` }}
          </button>
        </div>

        <p v-if="signups.length === 0" class="empty">還沒有人登記</p>
        <p v-else-if="shownSignups.length === 0" class="empty">沒有符合的登記</p>
        <div v-else class="table-wrap">
          <table class="signup-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>Email</th>
                <th>備註</th>
                <th>登記連結</th>
                <th>登記時間</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in shownSignups" :key="item.key">
                <td class="strong">{{ item.name }}</td>
                <td>
                  <span class="mono">{{ item.email }}</span>
                  <span v-if="item.status !== 'sent' && ticketFor(item.email)" class="warning-tag">已收過公關票</span>
                </td>
                <td class="note-cell">{{ item.note || '—' }}</td>
                <td class="note-cell">{{ linkById[item.linkId]?.title || '—' }}</td>
                <td class="num">{{ formatDateTime(item.createdAt) }}</td>
                <td>
                  <span class="status" :class="`signup-${item.status}`">{{ SIGNUP_STATUS[item.status] || item.status }}</span>
                </td>
                <td :class="{ mono: item.status === 'sent' }">
                  <div v-if="item.status !== 'sent'" class="row-actions">
                    <template v-if="item.status === 'pending'">
                      <button type="button" class="btn btn-small" :disabled="rowBusy(item)" @click="review([item], 'approved')">核准</button>
                      <button type="button" class="btn-outline btn-small danger" :disabled="rowBusy(item)" @click="review([item], 'rejected')">不通過</button>
                    </template>
                    <template v-else-if="item.status === 'approved'">
                      <button type="button" class="btn btn-small" :disabled="rowBusy(item)" @click="sendOne(item)">
                        {{ signupBusy.has(item.key) ? '寄出中...' : '寄出' }}
                      </button>
                      <button type="button" class="btn-outline btn-small" :disabled="rowBusy(item)" @click="review([item], 'pending')">取消核准</button>
                    </template>
                    <button v-else type="button" class="btn-outline btn-small" :disabled="rowBusy(item)" @click="review([item], 'pending')">重新審核</button>
                  </div>
                  <router-link v-else-if="item.orderId" :to="{ name: 'admin-order-detail', params: { id: item.orderId } }">{{ item.orderId }}</router-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" aria-labelledby="ledger-title">
        <div class="notify-header">
          <h2 id="ledger-title">已寄出的公關票</h2>
        </div>
        <p class="ledger-summary">
          <span><strong class="num">{{ shownTickets.length }}</strong> 人</span>
          <span><strong class="num">{{ ticketCount }}</strong> 張</span>
          <span>已領 <strong class="num">{{ deliveredCount }}</strong> 張</span>
        </p>
        <p class="panel-copy">
          公關票也在後台訂單列表裡（學校欄為「公關票」），可在那裡補寄邀請信或刪除；刪除後票券失效，張數退回發出的幹部
        </p>

        <label class="field source-filter">
          <span>發出者</span>
          <select v-model="sourceFilter" class="select-field">
            <option value="">全部</option>
            <option value="council">班聯會直接寄送</option>
            <option v-for="item in officers" :key="item.id" :value="item.email">{{ item.name || item.email }}</option>
          </select>
        </label>

        <p v-if="shownTickets.length === 0" class="empty">還沒有寄出公關票</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>發出者</th>
                <th>張數</th>
                <th>領票</th>
                <th>邀請信</th>
                <th>票券編號</th>
                <th>Email</th>
                <th>建立時間</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ticket in shownTickets" :key="ticket.id">
                <td class="strong">{{ ticket.customerName }}</td>
                <td>
                  {{ guestSourceText(ticket) }}<span v-if="ticket.inviteId" class="via">・連結<template v-if="notes[ticket.inviteId]">（{{ notes[ticket.inviteId] }}）</template></span><span v-else-if="ticket.signupLinkId" class="via">・登記<template v-if="linkById[ticket.signupLinkId]">（{{ linkById[ticket.signupLinkId].title }}）</template></span>
                </td>
                <td class="num">{{ quantityOf(ticket) }}</td>
                <td>
                  <span class="status" :class="{ on: ticket.delivered }">{{ ticket.delivered ? '已領票' : '未領票' }}</span>
                </td>
                <td>{{ EMAIL_STATUS[ticket.emailStatus] || '—' }}</td>
                <td class="mono">
                  <router-link :to="{ name: 'admin-order-detail', params: { id: ticket.id } }">{{ ticket.id }}</router-link>
                </td>
                <td class="mono">{{ ticket.customerEmail }}</td>
                <td class="num">{{ formatDateTime(ticket.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import QuantityStepper from 'src/components/QuantityStepper.vue'
import { SITE_URL } from 'src/config/app'
import {
  MAX_GUEST_TICKETS,
  MAX_INVITE_NOTE,
  MAX_OFFICER_QUOTA,
  MAX_SIGNUP_TITLE,
  SIGNUP_STATUS,
  guestSourceText
} from 'src/data/guests'
import {
  addOfficer,
  createCouncilInvite,
  createSignupLink,
  deleteOfficer,
  fetchAllInviteNotes,
  fetchAllInvites,
  fetchAllSignups,
  fetchGuestTickets,
  fetchOfficers,
  fetchSignupLinks,
  inviteUrl,
  quantityOf,
  remainingOf,
  reviewSignups,
  revokeOfficerInvite,
  sendGuestInvitation,
  sendSignupTicket,
  setSignupLinkOpen,
  signupUrl,
  updateOfficer
} from 'src/services/guestService'
import { createRequestId } from 'src/services/orderService'
import { formatDateTime } from 'src/utils/datetime'
import { EMAIL_STATUS } from 'src/utils/orderBackup'

const auth = useAuthStore()
const toast = useToastStore()

const OFFICER_PAGE_URL = `${SITE_URL}/officer`
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

const emptyForm = () => ({ name: '', email: '', quantity: 1 })
const emptyOfficer = () => ({ email: '', name: '', quota: 10 })

const loading = ref(true)
const refreshing = ref(false)
const loadError = ref(false)
const officers = ref([])
const invites = ref([])
// { [inviteId]: note }
const notes = ref({})
const tickets = ref([])
const officerSearch = ref('')
const sourceFilter = ref('')

const newOfficer = ref(emptyOfficer())
const adding = ref(false)
const addError = ref('')

// the officer whose name and quota are being changed
const editingId = ref(null)
const editForm = ref({ name: '', quota: 0 })
const editError = ref('')
// officers being saved or deleted
const busyIds = reactive(new Set())

// sending by name and email outside any quota; it waits for a second look
// (directReview) before it goes out
const directOpen = ref(false)
const form = ref(emptyForm())
const directReview = ref(false)
const directError = ref('')
const sending = ref(false)

// a council invite link, outside any quota
const inviteQuantity = ref(1)
const inviteNote = ref('')
const creating = ref(false)
const inviteError = ref('')
// the link just made, shown until it is copied
const createdInvite = ref(null)
const revokingIds = reactive(new Set())
const validInviteQuantity = computed(
  () => Number.isInteger(inviteQuantity.value) && inviteQuantity.value >= 1 && inviteQuantity.value <= MAX_GUEST_TICKETS
)

// 登記連結: one link for a group, whose sign-ups wait for review here
const signupLinks = ref([])
// every link's sign-ups, each with `key` (its path), linkId and uid
const signups = ref([])
const signupTitle = ref('')
const signupQuantity = ref(1)
const creatingSignup = ref(false)
const signupLinkError = ref('')
// the link just made, shown until it is copied
const createdSignupLink = ref(null)
// links being closed or reopened
const linkBusyIds = reactive(new Set())
const signupLinkValid = computed(
  () =>
    signupTitle.value.trim() !== '' &&
    Number.isInteger(signupQuantity.value) && signupQuantity.value >= 1 && signupQuantity.value <= MAX_GUEST_TICKETS
)
const linkById = computed(() => Object.fromEntries(signupLinks.value.map((item) => [item.id, item])))
const signupsOf = (linkId) => signups.value.filter((item) => item.linkId === linkId)
const pendingOf = (linkId) => signupsOf(linkId).filter((item) => item.status === 'pending').length

// the review: by link, then by status
const signupLinkFilter = ref('')
const signupStatusFilter = ref('')
// sign-ups being reviewed or sent, by key
const signupBusy = reactive(new Set())
const approvingAll = ref(false)
// { done, total } while approved sign-ups are being sent
const sendProgress = ref(null)
const batchBusy = computed(() => approvingAll.value || sendProgress.value !== null)
const rowBusy = (item) => batchBusy.value || signupBusy.has(item.key)

const linkSignups = computed(() => (signupLinkFilter.value ? signupsOf(signupLinkFilter.value) : signups.value))
const shownSignups = computed(() =>
  signupStatusFilter.value ? linkSignups.value.filter((item) => item.status === signupStatusFilter.value) : linkSignups.value
)
const signupCounts = computed(() => {
  const counts = Object.fromEntries(Object.keys(SIGNUP_STATUS).map((key) => [key, 0]))
  for (const item of linkSignups.value) if (item.status in counts) counts[item.status]++
  return counts
})
const linkPending = computed(() => linkSignups.value.filter((item) => item.status === 'pending'))
const linkApproved = computed(() => linkSignups.value.filter((item) => item.status === 'approved'))
const ticketsFor = (items) => items.reduce((sum, item) => sum + (Number(linkById.value[item.linkId]?.quantity) || 0), 0)

const validQuota = (quota, min = 0) => Number.isInteger(quota) && quota >= min && quota <= MAX_OFFICER_QUOTA

const normalizedNewEmail = computed(() => newOfficer.value.email.trim().toLowerCase())
const officerTaken = computed(() => officers.value.some((item) => item.id === normalizedNewEmail.value))
const newOfficerValid = computed(
  () =>
    EMAIL_PATTERN.test(normalizedNewEmail.value) &&
    newOfficer.value.name.trim() !== '' &&
    validQuota(newOfficer.value.quota) &&
    !officerTaken.value
)
const editValid = (item) => editForm.value.name.trim() !== '' && validQuota(editForm.value.quota, item.used || 0)

const openInvites = computed(() => invites.value.filter((invite) => invite.status === 'open'))
const heldBy = (email) =>
  openInvites.value.filter((invite) => invite.officerEmail === email).reduce((sum, invite) => sum + (Number(invite.quantity) || 0), 0)
const quotaTotal = computed(() => officers.value.reduce((sum, item) => sum + (Number(item.quota) || 0), 0))
const usedTotal = computed(() => officers.value.reduce((sum, item) => sum + (Number(item.used) || 0), 0))
const heldTotal = computed(() => openInvites.value.reduce((sum, invite) => sum + (Number(invite.quantity) || 0), 0))

const shownOfficers = computed(() => {
  const q = officerSearch.value.trim().toLowerCase()
  return q ? officers.value.filter((item) => [item.name, item.email].some((value) => String(value || '').toLowerCase().includes(q))) : officers.value
})

const ticketFor = (email) => {
  const address = String(email || '').trim().toLowerCase()
  return address ? tickets.value.find((ticket) => ticket.customerEmail === address) || null : null
}
const earlierTicket = computed(() => ticketFor(form.value.email))

const formValid = computed(() => {
  const { name, email, quantity } = form.value
  return (
    name.trim() !== '' &&
    EMAIL_PATTERN.test(email.trim()) &&
    Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_GUEST_TICKETS
  )
})

const shownTickets = computed(() => {
  if (!sourceFilter.value) return tickets.value
  if (sourceFilter.value === 'council') return tickets.value.filter((ticket) => !ticket.officerEmail)
  return tickets.value.filter((ticket) => ticket.officerEmail === sourceFilter.value)
})
const ticketCount = computed(() => shownTickets.value.reduce((sum, ticket) => sum + quantityOf(ticket), 0))
const deliveredCount = computed(() =>
  shownTickets.value.filter((ticket) => ticket.delivered).reduce((sum, ticket) => sum + quantityOf(ticket), 0)
)

// any change to the details asks for another look
watch(form, () => { directReview.value = false }, { deep: true })

// `showLoading` false keeps the page up while the lists refresh
async function load(showLoading = true) {
  if (showLoading) loading.value = true
  else refreshing.value = true
  loadError.value = false

  try {
    const [officerList, inviteList, sent, noteMap, linkList, signupList] = await Promise.all([
      fetchOfficers(),
      fetchAllInvites(),
      fetchGuestTickets(),
      fetchAllInviteNotes(),
      fetchSignupLinks(),
      fetchAllSignups()
    ])
    officers.value = officerList
    invites.value = inviteList
    notes.value = noteMap
    tickets.value = sent
    signupLinks.value = linkList
    signups.value = signupList
  } catch (error) {
    console.error('Load guests error:', error)
    if (showLoading) loadError.value = true
    else toast.show('重新整理失敗，請稍後再試')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function submitOfficer() {
  if (!newOfficerValid.value || adding.value) return

  adding.value = true
  addError.value = ''
  try {
    await addOfficer({
      email: normalizedNewEmail.value,
      name: newOfficer.value.name.trim(),
      quota: newOfficer.value.quota
    })
    toast.show(`已新增幹部 ${newOfficer.value.name.trim()}`)
    newOfficer.value = emptyOfficer()
    await load(false)
  } catch (error) {
    console.error('Add officer error:', error)
    // the rules refuse a second create of the same email
    addError.value = error?.code === 'permission-denied' ? '新增失敗：這個 Email 可能已經在名單中，請重新整理' : '新增失敗，請稍後再試'
  } finally {
    adding.value = false
  }
}

function toggleEdit(item) {
  if (editingId.value === item.id) {
    editingId.value = null
    return
  }
  editingId.value = item.id
  editForm.value = { name: item.name || '', quota: Number(item.quota) || 0 }
  editError.value = ''
}

async function saveOfficer(item) {
  if (!editValid(item) || busyIds.has(item.id)) return

  busyIds.add(item.id)
  editError.value = ''
  try {
    await updateOfficer(item.id, { name: editForm.value.name.trim(), quota: editForm.value.quota })
    editingId.value = null
    toast.show('已更新幹部額度')
    await load(false)
  } catch (error) {
    console.error('Update officer error:', error)
    // the rules refuse a quota below what the officer has used meanwhile
    editError.value = error?.code === 'permission-denied' ? '儲存失敗：額度不能低於已使用的張數，請重新整理後再試' : '儲存失敗，請稍後再試'
  } finally {
    busyIds.delete(item.id)
  }
}

async function removeOfficer(item) {
  const held = heldBy(item.email)
  const note = `已寄出的公關票仍然有效${held ? `；未領取的 ${held} 張連結會失效` : ''}`
  if (!window.confirm(`確定要把 ${item.name || item.email} 移出幹部名單嗎？${note}`)) return

  busyIds.add(item.id)
  try {
    await deleteOfficer(item.id)
    officers.value = officers.value.filter((officer) => officer.id !== item.id)
    if (editingId.value === item.id) editingId.value = null
    toast.show('已移出幹部名單')
  } catch (error) {
    console.error('Delete officer error:', error)
    toast.show('刪除失敗，請稍後再試')
  } finally {
    busyIds.delete(item.id)
  }
}

// The send whose outcome is unknown (the response was lost). Sending the
// same again reuses its requestId, so the server returns that ticket
// instead of creating a second one.
let pending = null

// definite refusals, explained by the server's message
const REFUSALS = ['functions/invalid-argument', 'functions/permission-denied', 'functions/failed-precondition']

function reviewDirect() {
  if (!formValid.value || sending.value) return
  directError.value = ''
  directReview.value = true
}

async function sendDirect() {
  if (!formValid.value || sending.value) return

  sending.value = true
  directError.value = ''
  const input = {
    name: form.value.name.trim(),
    email: form.value.email.trim().toLowerCase(),
    quantity: form.value.quantity
  }
  const key = JSON.stringify(input)
  if (pending?.key !== key) pending = { key, requestId: createRequestId() }

  try {
    const { id } = await sendGuestInvitation({ ...input, requestId: pending.requestId })
    pending = null
    form.value = emptyForm()
    toast.show(`已建立公關票 ${id}，邀請信約一分鐘內寄出`, 6000)
    await load(false)
  } catch (error) {
    console.error('Send guest invitation error:', error)
    if (REFUSALS.includes(error?.code)) {
      // nothing was created: the next try is a new send
      pending = null
      directError.value = error.message
    } else {
      directError.value = '寄送失敗，請稍後再試（再按一次不會重複寄送）'
    }
  } finally {
    sending.value = false
  }
}

async function createInvite() {
  if (!validInviteQuantity.value || creating.value) return

  creating.value = true
  inviteError.value = ''
  const input = { quantity: inviteQuantity.value, note: inviteNote.value.trim() }
  const key = JSON.stringify({ invite: input })
  if (pending?.key !== key) pending = { key, requestId: createRequestId() }

  try {
    const { id } = await createCouncilInvite({ ...input, requestId: pending.requestId })
    pending = null
    createdInvite.value = { id, ...input }
    inviteQuantity.value = 1
    inviteNote.value = ''
    await load(false)
  } catch (error) {
    console.error('Create council invite error:', error)
    if (REFUSALS.includes(error?.code)) {
      pending = null
      inviteError.value = error.message
    } else {
      inviteError.value = '產生失敗，請稍後再試（再按一次不會重複產生）'
    }
  } finally {
    creating.value = false
  }
}

async function revoke(invite) {
  const owner = invite.officerEmail ? `${invite.officerName || invite.officerEmail} 的` : '班聯會的'
  const refund = invite.officerEmail ? '，張數會退回該幹部的額度' : ''
  if (!window.confirm(`確定要撤銷${owner} ${invite.quantity} 張連結嗎？撤銷後連結就不能用了${refund}`)) return

  revokingIds.add(invite.id)
  try {
    await revokeOfficerInvite(invite.id)
    if (createdInvite.value?.id === invite.id) createdInvite.value = null
    toast.show('已撤銷連結')
  } catch (error) {
    console.error('Revoke invite error:', error)
    toast.show(REFUSALS.includes(error?.code) ? error.message : '撤銷失敗，請稍後再試')
  } finally {
    revokingIds.delete(invite.id)
    await load(false)
  }
}

/* ---------- 登記連結 ---------- */

async function createSignup() {
  if (!signupLinkValid.value || creatingSignup.value) return

  creatingSignup.value = true
  signupLinkError.value = ''
  const input = { title: signupTitle.value.trim(), quantity: signupQuantity.value }
  const key = JSON.stringify({ signupLink: input })
  if (pending?.key !== key) pending = { key, requestId: createRequestId() }

  try {
    const { id } = await createSignupLink({ ...input, requestId: pending.requestId })
    pending = null
    createdSignupLink.value = { id, ...input }
    signupTitle.value = ''
    signupQuantity.value = 1
    await load(false)
  } catch (error) {
    console.error('Create sign-up link error:', error)
    if (REFUSALS.includes(error?.code)) {
      pending = null
      signupLinkError.value = error.message
    } else {
      signupLinkError.value = '產生失敗，請稍後再試（再按一次不會重複產生）'
    }
  } finally {
    creatingSignup.value = false
  }
}

// closing keeps the sign-ups so far, for review and sending
async function toggleSignupLink(item) {
  const open = !item.open
  linkBusyIds.add(item.id)
  try {
    await setSignupLinkOpen(item.id, open)
    item.open = open
    toast.show(open ? `已重新開放「${item.title}」登記` : `已停止「${item.title}」登記，已登記的人仍可審核與寄出`)
  } catch (error) {
    console.error('Toggle sign-up link error:', error)
    toast.show('更新失敗，請稍後再試')
  } finally {
    linkBusyIds.delete(item.id)
  }
}

function reviewedText(items, status) {
  const who = items.length > 1 ? `${items.length} 位` : items[0].name
  return { approved: `已核准 ${who}`, rejected: `已將 ${who} 設為不通過`, pending: `已將 ${who} 改回待審核` }[status]
}

// `status`: 'approved', 'rejected' or back to 'pending'
async function review(items, status) {
  items.forEach((item) => signupBusy.add(item.key))
  try {
    await reviewSignups(items, status, auth.user.uid)
    items.forEach((item) => { item.status = status })
    toast.show(reviewedText(items, status))
  } catch (error) {
    console.error('Review sign-ups error:', error)
    // the rules refuse a sign-up sent meanwhile
    toast.show('更新失敗：登記狀態可能已經變更，已重新整理')
    await load(false)
  } finally {
    items.forEach((item) => signupBusy.delete(item.key))
  }
}

async function approveAll() {
  const items = [...linkPending.value]
  if (items.length === 0 || batchBusy.value) return
  if (!window.confirm(`確定要核准全部 ${items.length} 位待審核的登記嗎？`)) return

  approvingAll.value = true
  try {
    await review(items, 'approved')
  } finally {
    approvingAll.value = false
  }
}

// Sends each sign-up its ticket, a few at a time. Each call is safe to
// repeat: a sign-up already sent returns its order.
async function sendSignups(items) {
  sendProgress.value = { done: 0, total: items.length }
  const queue = [...items]
  const failures = []

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()
      signupBusy.add(item.key)
      try {
        const { id } = await sendSignupTicket(item)
        Object.assign(item, { status: 'sent', orderId: id })
      } catch (error) {
        console.error('Send sign-up ticket error:', error)
        failures.push(error)
      } finally {
        signupBusy.delete(item.key)
        sendProgress.value.done++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker))
  sendProgress.value = null

  const sent = items.length - failures.length
  if (failures.length === 0) {
    toast.show(`已寄出 ${sent} 位的公關票，邀請信約一分鐘內寄到`, 6000)
  } else {
    const reason = REFUSALS.includes(failures[0]?.code) ? failures[0].message : '請稍後再試（再按一次不會重複寄送）'
    toast.show(`已寄出 ${sent} 位，${failures.length} 位失敗：${reason}`, 8000)
  }
  // the ledger below shows the new tickets
  await load(false)
}

function sendOne(item) {
  if (batchBusy.value || signupBusy.has(item.key)) return
  const quantity = Number(linkById.value[item.linkId]?.quantity) || 0
  if (!window.confirm(`確定要寄出 ${quantity} 張公關票給 ${item.name}（${item.email}）嗎？`)) return
  sendSignups([item])
}

function sendApproved() {
  const items = [...linkApproved.value]
  if (items.length === 0 || batchBusy.value) return
  if (!window.confirm(`確定要寄出公關票給 ${items.length} 位已核准的登記者嗎？共 ${ticketsFor(items)} 張，邀請信會寄到他們登入的 Email`)) return
  sendSignups(items)
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    toast.show(message)
  } catch {
    toast.show('無法複製，請手動複製連結')
  }
}

onMounted(load)
</script>

<style scoped>
@import 'src/css/managementpage.scss';
@import 'src/css/selleradminpage.scss';
@import 'src/css/guestadminpage.scss';
</style>
