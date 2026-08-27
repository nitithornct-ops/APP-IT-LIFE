-- Interactive check marks in a rendered Ticket form are stored per Ticket and template version.
-- Keeping the template identity prevents positions from being applied to a later edited template.
alter table public.tickets
  add column if not exists form_checkmarks jsonb;

alter table public.tickets
  drop constraint if exists tickets_form_checkmarks_shape_check;

alter table public.tickets
  add constraint tickets_form_checkmarks_shape_check check (
    form_checkmarks is null
    or (
      jsonb_typeof(form_checkmarks) = 'object'
      and jsonb_typeof(form_checkmarks -> 'indices') = 'array'
      and (
        not (form_checkmarks ? 'textValues')
        or jsonb_typeof(form_checkmarks -> 'textValues') = 'object'
      )
    )
  );

comment on column public.tickets.form_checkmarks is
  'Interactive check marks and text-field values for the rendered Ticket form, scoped by templateId and templateVersion.';
