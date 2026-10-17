import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, MessageSquare } from 'lucide-react';
import { copyText, blockReference } from './clipboard';
import { readTextSelection, type TextSelection } from './textSelection';
import type { DocumentDefinition } from './DocumentRenderer';

/** Selection updates must never rerender the document being selected. */
export function ReportSelectionTools({ root, definition, renderedRef, onComment, commentable = true }: {
  root: RefObject<HTMLElement | null>; definition: DocumentDefinition; renderedRef: string;
  onComment: (selection: TextSelection) => void; commentable?: boolean;
}) {
  const [passage, setPassage] = useState<{ selection: TextSelection; x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false), [error, setError] = useState(''), [manual,setManual]=useState('');
  useEffect(() => {
    let frame = 0, dragging = false;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (dragging || document.activeElement?.closest('.report-selection-tools')) return;
        const selection = window.getSelection(), element = root.current;
        if (!selection?.rangeCount || !element) { setPassage(null); return; }
        try {
          const range = selection.getRangeAt(0), anchor = readTextSelection(element, range);
          if (!anchor) { setPassage(null); return; }
          // Anchor above the final selected line rather than a large union rect.
          const rectangles = range.getClientRects(), bounds = rectangles[rectangles.length - 1] || range.getBoundingClientRect();
          setPassage({ selection: anchor, x: Math.max(120, Math.min(window.innerWidth - 120, bounds.left + bounds.width / 2)), y: Math.max(8, Math.min(window.innerHeight - 50, bounds.top - 44)) });
          setError(''); setCopied(false);
        } catch (cause) { setPassage(null); setError((cause as Error).message); }
      });
    };
    const start = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) { dragging = true; setPassage(null); }
    };
    const finish = () => { dragging = false; update(); };
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerdown', start); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', finish);
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('selectionchange', update); document.removeEventListener('pointerdown', start); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [root, renderedRef]);
  async function copy(selection: TextSelection) {
    const block=definition.blocks.find(block=>block.id===selection.start.block_id);
    if(!definition.publication||!block){setError('This passage has no published reference.');return;}
    let reference="";
    try { reference=blockReference(definition.publication,block,selection); await copyText(reference); setCopied(true); setError('');setManual(''); }
    catch(cause) { setError(String(cause));setManual(reference); }
  }
  return createPortal(<>
    {passage && <div className="report-selection-tools" role="toolbar" aria-label="Selected text actions" style={{ left: passage.x, top: passage.y }} onPointerDown={event => event.preventDefault()}>
      <button onClick={() => copy(passage.selection)}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy reference</button>
      <button disabled={!commentable} title={!commentable ? 'This build was not committed to a report revision. Rebuild the current report before commenting.' : undefined} onClick={() => { const selected = passage.selection; setPassage(null); window.getSelection()?.removeAllRanges(); onComment(selected); }}><MessageSquare size={14} /> Comment</button>
    </div>}
    {error && <div className="report-selection-error" role="status">{error}{manual&&<textarea readOnly aria-label="Reference to copy" value={manual} onFocus={event=>event.currentTarget.select()}/>}<button aria-label="Dismiss selection message" onClick={() => setError('')}>×</button></div>}
  </>, document.body);
}
