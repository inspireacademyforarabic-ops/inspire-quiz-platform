import { phoneOf } from './otp'

export const EXAMS = ['UGC NET', 'JRF', 'SET', 'KTET', 'PSC', 'Other']
export const QUALS = ['Degree (BA)', 'Postgraduate (MA)', 'M.Phil', 'PhD', 'B.Ed', 'Other']
export const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry', 'Outside India']

export type Details = { name: string; phone: string; exam: string; state: string; city: string; qualification: string }
export type Parsed = { ok: true; value: Details } | { ok: false; error: string }

const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

/** Validates the student details form (sign-up and "edit my details"). Everything here is required. */
export function parseDetails(b: Record<string, unknown>): Parsed {
  const name = clean(b.name, 80), city = clean(b.city, 60)
  const phone = phoneOf(String(b.phone ?? ''))
  const exam = clean(b.exam, 30), state = clean(b.state, 60), qualification = clean(b.qualification, 30)
  if (name.length < 2) return { ok: false, error: 'Enter your full name' }
  if (!phone) return { ok: false, error: 'Enter your 10-digit mobile number' }
  if (!EXAMS.includes(exam)) return { ok: false, error: 'Choose the exam you are preparing for' }
  if (!STATES.includes(state)) return { ok: false, error: 'Choose your state' }
  if (city.length < 2) return { ok: false, error: 'Enter your city or district' }
  if (!QUALS.includes(qualification)) return { ok: false, error: 'Choose your qualification' }
  return { ok: true, value: { name, phone, exam, state, city, qualification } }
}
