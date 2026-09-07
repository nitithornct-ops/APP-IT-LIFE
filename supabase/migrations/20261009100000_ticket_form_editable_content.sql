-- A Ticket form could only be filled in, never adjusted: check marks and blank-line text were the
-- only editable parts (20260927100000_ticket_form_checkmarks). Staff who needed to reword a row,
-- add a note, or force a page break before printing had no way to do it without editing the master
-- template in Form Studio, which would change every other Ticket too.
--
-- This column holds a per-Ticket override of the rendered document. Null means "follow the
-- template", which is still the default for every Ticket and the state the reset action returns to.
--
-- Deliberately a frozen snapshot: the value stored here is already-rendered HTML with {{field}}
-- placeholders resolved, so an overridden form stops tracking later Ticket changes. That trade-off
-- is what makes WYSIWYG editing possible at all, and the UI states it before the first save.
alter table public.tickets
  add column if not exists form_content_html text;

alter table public.tickets
  drop constraint if exists tickets_form_content_html_size_check;

-- Matches the 300k limit the API validator enforces, so an oversized document is refused by the
-- database too rather than only by whichever code path happened to run first.
alter table public.tickets
  add constraint tickets_form_content_html_size_check check (
    form_content_html is null or length(form_content_html) <= 300000
  );

comment on column public.tickets.form_content_html is
  'Per-Ticket override of the rendered form document. Null follows the Form Studio template.';
