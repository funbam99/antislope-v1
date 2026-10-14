// DOM-only rendering keeps model/user text inert. This intentionally supports
// common chat Markdown, not raw HTML, remote images, or executable extensions.
export const markdown = String.raw`
function inlineMarkdown(parent,value,depth=0){
  if(depth>6){parent.append(document.createTextNode(value));return;}
  const tokens=/\\([\\*_\x60~\[\]])|(\x60+)([^\n]*?)\2|\*\*([^\n]+?)\*\*|__([^\n]+?)__|~~([^\n]+?)~~|\*([^*\n]+?)\*|(?<!\w)_([^_\n]+?)_(?!\w)|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
  let end=0,match;
  while((match=tokens.exec(value))){parent.append(document.createTextNode(value.slice(end,match.index)));end=tokens.lastIndex;
    if(match[1]){parent.append(document.createTextNode(match[1]));continue;}
    if(match[2]){parent.append(node('code',match[3],'inline-code'));continue;}
    let tag=match[4]||match[5]?'strong':match[6]?'del':match[7]||match[8]?'em':'a',text=match[4]??match[5]??match[6]??match[7]??match[8]??match[9];
    if(tag==='a'&&(!/^https?:\/\//i.test(match[10])||value[match.index-1]==='!')){parent.append(document.createTextNode(match[0]));continue;}
    const element=node(tag);if(tag==='a'){element.href=match[10];element.target='_blank';element.rel='noopener noreferrer';element.referrerPolicy='no-referrer';}
    inlineMarkdown(element,text,depth+1);parent.append(element);
  }
  parent.append(document.createTextNode(value.slice(end)));
}
function highlightedCode(value,language){
  const code=node('code');
  if(!['ts','typescript','js','javascript','tsx','jsx','json',''].includes(language)){code.textContent=value;return code;}
  const tokens=/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60|\b(?:const|let|var|if|else|return|function|export|import|from|type|interface|class|new|throw|try|catch|finally|for|of|in|while|async|await|readonly|extends|implements|switch|case|break|continue|default|typeof|instanceof|true|false|null|undefined|number|string|boolean|void)\b|\b\d+(?:\.\d+)?\b)/g;
  let end=0,match;
  while((match=tokens.exec(value))){code.append(document.createTextNode(value.slice(end,match.index)));const text=match[0],kind=text.startsWith('//')||text.startsWith('/*')?'comment':/^['"\x60]/.test(text)?'string':/^\d/.test(text)?'number':'keyword';code.append(node('span',text,'syntax-'+kind));end=tokens.lastIndex;}
  code.append(document.createTextNode(value.slice(end)));return code;
}
function renderMarkdown(value,depth=0){
  const root=node('div',undefined,'markdown');if(depth>8){root.append(node('p',value));return root;}
  const lines=value.replace(/\r\n?/g,'\n').split('\n');let i=0;
  const fence=line=>/^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
  const list=line=>/^\s{0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
  const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
  const tableAt=index=>index+1<lines.length&&lines[index].includes('|')&&cells(lines[index+1]).length===cells(lines[index]).length&&cells(lines[index+1]).every(v=>/^:?-{3,}:?$/.test(v));
  const blockAt=index=>fence(lines[index])||/^ {0,3}#{1,6}\s/.test(lines[index])||/^\s*>/.test(lines[index])||list(lines[index])||/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(lines[index])||tableAt(index);
  while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
    const opening=fence(line);
    if(opening){const content=[],marker=opening[1][0],size=opening[1].length,language=opening[2].trim().split(/\s+/)[0].toLowerCase().slice(0,40);i++;
      while(i<lines.length){const close=fence(lines[i]);if(close&&close[1][0]===marker&&close[1].length>=size&&!close[2].trim()){i++;break;}content.push(lines[i++]);}
      const box=node('div',undefined,'code-block'),label=node('div',language||'Code','code-language'),pre=node('pre');pre.append(highlightedCode(content.join('\n'),language));box.append(label,pre);root.append(box);continue;
    }
    const heading=/^ {0,3}(#{1,6})\s+(.+)$/.exec(line);if(heading){const h=node('h'+heading[1].length);inlineMarkdown(h,heading[2].replace(/\s+#+\s*$/,''));root.append(h);i++;continue;}
    if(/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)){root.append(node('hr'));i++;continue;}
    if(/^\s*>/.test(line)){const content=[];while(i<lines.length&&/^\s*>/.test(lines[i]))content.push(lines[i++].replace(/^\s*> ?/,''));const quote=node('blockquote');quote.append(renderMarkdown(content.join('\n'),depth+1));root.append(quote);continue;}
    if(tableAt(i)){const table=node('table'),head=node('thead'),row=node('tr'),headers=cells(line);for(const value of headers){const cell=node('th');inlineMarkdown(cell,value);row.append(cell);}head.append(row);table.append(head);i+=2;const body=node('tbody');while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const row=node('tr'),values=cells(lines[i++]);for(let c=0;c<headers.length;c++){const cell=node('td');inlineMarkdown(cell,values[c]??'');row.append(cell);}body.append(row);}table.append(body);const wrapper=node('div',undefined,'markdown-table');wrapper.append(table);root.append(wrapper);continue;}
    const bullet=list(line);if(bullet){const ordered=!!bullet[2],group=node(ordered?'ol':'ul');if(ordered)group.start=Number(bullet[2]);while(i<lines.length){const item=list(lines[i]);if(!item||!!item[2]!==ordered)break;const li=node('li');inlineMarkdown(li,item[3]);group.append(li);i++;}root.append(group);continue;}
    const content=[line];i++;while(i<lines.length&&lines[i].trim()&&!blockAt(i))content.push(lines[i++]);const paragraph=node('p');inlineMarkdown(paragraph,content.join('\n'));root.append(paragraph);
  }
  return root;
}
`;
