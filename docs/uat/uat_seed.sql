-- =============================================================================
-- UAT seed — run after creating the 3 auth users in Supabase Dashboard.
-- =============================================================================
--
-- Pre-step (Supabase UI → Authentication → Add user):
--   1. uat-controller@vietjet.com  (password: ask facilitator)
--   2. uat-supervisor@vietjet.com  (password: ask facilitator)
--   3. uat-viewer@vietjet.com      (password: ask facilitator)
--
-- Then run this script in SQL Editor to assign roles.
-- =============================================================================

update profiles
   set role = 'controller'
 where email = 'uat-controller@vietjet.com';

-- If/when a 'supervisor' role is added to the profiles enum, switch this
-- update to use it. For now the supervisor uses the 'controller' role with
-- the same UI affordances; differentiation lives in audit-page filters and
-- (future) approval-revoke gating.
update profiles
   set role = 'controller'
 where email = 'uat-supervisor@vietjet.com';

update profiles
   set role = 'viewer'
 where email = 'uat-viewer@vietjet.com';

-- Verify
select email, role, created_at
  from profiles
 where email like 'uat-%@vietjet.com'
 order by email;
