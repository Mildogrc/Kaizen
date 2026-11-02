import { A } from '@solidjs/router';

export default function NotFound() {
  return (
    <div class="mx-auto max-w-md px-4 pt-24 text-center">
      <div class="text-[44px] font-semibold text-muted">404</div>
      <p class="mt-1 text-[13px] text-muted">That page doesn’t exist.</p>
      <A href="/" class="btn mt-4">Back to the dashboard</A>
    </div>
  );
}
