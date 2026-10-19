// The public survey (no sign-in). Validation mirrors the old Firestore rule
// for surveyResponses, with the options from src/client/data/surveyQuestions.js.
import { Hono } from 'hono'
import { valid } from '../validate'
import { z } from 'zod'
import type { AppEnv } from '../context'
import {
  CHANNEL_OPTIONS,
  DEVICE_OPTIONS,
  IDENTITY_OPTIONS,
  ISSUE_COUNT_OPTIONS,
  ISSUE_TYPE_OPTIONS
} from '../../client/data/surveyQuestions.js'

const SCORE_KEYS = Array.from({ length: 26 }, (_, i) => `q${i + 4}`) // q4..q29
const values = (options: readonly (string | { value: string })[]) =>
  options.map((option) => (typeof option === 'string' ? option : option.value)) as [string, ...string[]]

const surveyBody = z.object({
  identity: z.enum(values(IDENTITY_OPTIONS)),
  channels: z.array(z.enum(values(CHANNEL_OPTIONS))).min(1).max(CHANNEL_OPTIONS.length),
  device: z.enum(values(DEVICE_OPTIONS)),
  scores: z.object(Object.fromEntries(SCORE_KEYS.map((key) => [key, z.number().int().min(1).max(5)]))).strict(),
  issueCount: z.enum(values(ISSUE_COUNT_OPTIONS)),
  issueTypes: z.array(z.enum(values(ISSUE_TYPE_OPTIONS))).max(ISSUE_TYPE_OPTIONS.length),
  improvement: z.string().max(2000),
  suggestion: z.string().max(2000)
}).strict()

export const surveyRoutes = new Hono<AppEnv>()
  .post('/', valid('json', surveyBody), async (c) => {
    const s = c.req.valid('json')
    await c.env.DB.prepare(
      `INSERT INTO survey_responses (identity, channels, device, scores, issue_count, issue_types, improvement, suggestion, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(s.identity, JSON.stringify(s.channels), s.device, JSON.stringify(s.scores), s.issueCount,
      JSON.stringify(s.issueTypes), s.improvement.trim(), s.suggestion.trim(), Date.now()).run()
    return c.json({ ok: true }, 201)
  })
