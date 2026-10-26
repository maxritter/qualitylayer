import React, { type ReactNode } from 'react';
import { Lexer, type Token, type Tokens } from 'marked';

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function inline(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'strong': return <strong key={index}>{inline((token as Tokens.Strong).tokens)}</strong>;
      case 'em': return <em key={index}>{inline((token as Tokens.Em).tokens)}</em>;
      case 'codespan': return <code key={index}>{(token as Tokens.Codespan).text}</code>;
      case 'link': {
        const link = token as Tokens.Link;
        return SAFE_LINK.test(link.href) ? <a key={index} href={link.href} target="_blank" rel="noopener noreferrer">{inline(link.tokens)}</a> : <span key={index}>{inline(link.tokens)}</span>;
      }
      case 'br': return <br key={index} />;
      case 'del': return <del key={index}>{inline((token as Tokens.Del).tokens)}</del>;
      case 'text': {
        const text = token as Tokens.Text;
        return <React.Fragment key={index}>{text.tokens ? inline(text.tokens) : text.text}</React.Fragment>;
      }
      case 'image': return <span key={index}>{(token as Tokens.Image).text}</span>;
      default: return <React.Fragment key={index}>{token.raw}</React.Fragment>;
    }
  });
}

function blocks(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'space':
      case 'def': return null;
      case 'paragraph': return <p key={index}>{inline((token as Tokens.Paragraph).tokens)}</p>;
      case 'heading': {
        const heading = token as Tokens.Heading;
        const Tag = `h${Math.min(6, Math.max(3, heading.depth + 1))}` as 'h3';
        return <Tag key={index}>{inline(heading.tokens)}</Tag>;
      }
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.map((item, n) => <li key={n}>{blocks(item.tokens)}</li>);
        return list.ordered ? <ol key={index} start={typeof list.start === 'number' ? list.start : undefined}>{items}</ol> : <ul key={index}>{items}</ul>;
      }
      case 'text': {
        const text = token as Tokens.Text;
        return <React.Fragment key={index}>{text.tokens ? inline(text.tokens) : text.text}</React.Fragment>;
      }
      case 'code': return <pre key={index}><code>{(token as Tokens.Code).text}</code></pre>;
      case 'blockquote': return <blockquote key={index}>{blocks((token as Tokens.Blockquote).tokens)}</blockquote>;
      case 'table': {
        const table = token as Tokens.Table;
        return <table key={index}><thead><tr>{table.header.map((cell, n) => <th key={n}>{inline(cell.tokens)}</th>)}</tr></thead><tbody>{table.rows.map((row, n) => <tr key={n}>{row.map((cell, c) => <td key={c}>{inline(cell.tokens)}</td>)}</tr>)}</tbody></table>;
      }
      case 'hr': return <hr key={index} />;
      default: return <p key={index}>{token.raw}</p>;
    }
  });
}

/** The App's token-to-React approach: release text never becomes HTML or executable MDX. */
export default function ReleaseMarkdown({ notes }: { notes: string }) {
  return <>{blocks(Lexer.lex(notes.replace(/<!--[\s\S]*?-->/g, '')))}</>;
}
