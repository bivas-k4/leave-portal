// Fill these in from Supabase Dashboard > Project Settings > API.
// The anon key is meant to be public; your data is protected by the database rules in supabase/schema.sql.
// NEVER put the service_role key here.
export const SUPABASE_URL = "https://xpmznrnzuotzwzzlukff.supabase.co/rest/v1/";
export const SUPABASE_ANON_KEY = "sb_publishable__o7LR70N2joFT9Gi9TF9gQ_ofWQitNL";

export const COMPANY_NAME = "Our Department";

// Yearly allowance per leave type (days). Use null for no limit.
export const LEAVE_TYPES = [
  { name: "Casual Leave", allowance: 12 },
  { name: "Sick Leave", allowance: 12 },
  { name: "Earned Leave", allowance: 15 },
  { name: "Unpaid Leave", allowance: null },
];
