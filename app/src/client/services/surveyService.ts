import { client, unwrap } from 'src/api'

export function submitSurvey(response: Record<string, unknown>) {
  return unwrap(client.survey.$post({ json: response as never }))
}

export async function fetchSurveyResponses() {
  return (await unwrap(client.admin.survey.$get())).responses
}
