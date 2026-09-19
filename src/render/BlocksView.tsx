import type { Block } from '../ai/blocks';
import { renderMath, renderRichText } from './math';
import { SignTable } from './SignTable';

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      return <h3 className="b-heading" dangerouslySetInnerHTML={{ __html: renderRichText(block.content) }} />;
    case 'text':
      return <p className="b-text" dangerouslySetInnerHTML={{ __html: renderRichText(block.content) }} />;
    case 'math':
      return <div className="b-math" dangerouslySetInnerHTML={{ __html: renderMath(block.content, true) }} />;
    case 'list':
      return (
        <ul className="b-list">
          {block.items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: renderRichText(item) }} />
          ))}
        </ul>
      );
    case 'sign_table':
      return <SignTable source={block.content} />;
    case 'figure':
      return <p className="b-figure">Figure : {block.content}</p>;
  }
}

export function BlocksView({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) return <p className="b-empty">Rien de reconnu dans cette zone.</p>;
  return (
    <div className="blocks">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}
