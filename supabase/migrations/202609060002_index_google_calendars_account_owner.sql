create index google_calendars_google_account_owner_idx
  on public.google_calendars (google_account_id, owner_user_id);
