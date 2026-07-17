// Turns Anki's rendered card HTML into readable plain text. Card templates
// embed <style> blocks whose CSS text would survive naive tag-stripping, so
// remove style/script/head content first, then tags, sounds, and entities.

export function stripAnkiHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[sound:[^\]]*\]/g, ' ')
    .replace(/\[anki:play:[^\]]*\]/g, ' ')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/(\s·\s)+$/g, '')
    .trim();
}
