// Deploy-time settings, read from functions/.env (change them there, no code
// edit needed). See functions/README.md.
import { defineBoolean, defineInt } from 'firebase-functions/params'

// Reject callable requests without a valid App Check token. Turn on only after
// App Check (reCAPTCHA Enterprise) is set up and APP_CHECK_SITE_KEY is filled
// in src/config/app.js, otherwise every order is rejected.
export const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: false })

// Warm createOrder instances kept running; raise to 2-3 around the sale
// opening to avoid cold starts, set back to 0 afterwards (it costs money).
export const CREATE_ORDER_MIN_INSTANCES = defineInt('CREATE_ORDER_MIN_INSTANCES', { default: 0 })

// Max orders per client IP per 10 minutes, 0 = off. Schools and mobile
// carriers put many buyers behind one IP, so keep this generous.
export const ORDER_LIMIT_PER_IP = defineInt('ORDER_LIMIT_PER_IP', { default: 0 })

// SES sending rate of the AWS account, in recipients per second.
export const SES_RECIPIENTS_PER_SECOND = defineInt('SES_RECIPIENTS_PER_SECOND', { default: 14 })
