%lex

%x line_start
%{
this.begin('line_start');
%}

%%
<INITIAL,line_start>\n      { this.begin('line_start'); return 'NEWLINE'; }
<line_start>[ \t]+          { this.begin('INITIAL'); return 'INDENT'; }
<line_start>(?=[^ \t\n])    { this.begin('INITIAL'); }
<INITIAL>[ \t]+             /* ignore non-leading whitespace */
<INITIAL,line_start>"wireframe"                 { this.begin('INITIAL'); return 'WIREFRAME'; }
<INITIAL,line_start>"mobile"                    { this.begin('INITIAL'); return 'MOBILE'; }
<INITIAL,line_start>"tablet"                    { this.begin('INITIAL'); return 'TABLET'; }
<INITIAL,line_start>"desktop"                   { this.begin('INITIAL'); return 'DESKTOP'; }
<INITIAL,line_start>"TD"                        { this.begin('INITIAL'); return 'TD'; }
<INITIAL,line_start>"LR"                        { this.begin('INITIAL'); return 'LR'; }
<INITIAL,line_start>"screen"                    { this.begin('INITIAL'); return 'SCREEN'; }
<INITIAL,line_start>"col"                       { this.begin('INITIAL'); return 'COL'; }
<INITIAL,line_start>"row"                       { this.begin('INITIAL'); return 'ROW'; }
<INITIAL,line_start>"Text"                      { this.begin('INITIAL'); return 'TEXT'; }
<INITIAL,line_start>"Title"                     { this.begin('INITIAL'); return 'TITLE'; }
<INITIAL,line_start>"Button"                    { this.begin('INITIAL'); return 'BUTTON'; }
<INITIAL,line_start>"Input"                     { this.begin('INITIAL'); return 'INPUT'; }
<INITIAL,line_start>"Checkbox"                  { this.begin('INITIAL'); return 'CHECKBOX'; }
<INITIAL,line_start>"Radio"                     { this.begin('INITIAL'); return 'RADIO'; }
<INITIAL,line_start>"Switch"                    { this.begin('INITIAL'); return 'SWITCH'; }
<INITIAL,line_start>"Dropdown"                  { this.begin('INITIAL'); return 'DROPDOWN'; }
<INITIAL,line_start>"List"                      { this.begin('INITIAL'); return 'LIST'; }
<INITIAL,line_start>"NavMenu"                   { this.begin('INITIAL'); return 'NAVMENU'; }
<INITIAL,line_start>"BottomNav"                 { this.begin('INITIAL'); return 'BOTTOMNAV'; }
<INITIAL,line_start>"AppBar"                    { this.begin('INITIAL'); return 'APPBAR'; }
<INITIAL,line_start>"FAB"                       { this.begin('INITIAL'); return 'FAB'; }
<INITIAL,line_start>"Avatar"                    { this.begin('INITIAL'); return 'AVATAR'; }
<INITIAL,line_start>"Icon"                      { this.begin('INITIAL'); return 'ICON'; }
<INITIAL,line_start>"Image"                     { this.begin('INITIAL'); return 'IMAGE'; }
<INITIAL,line_start>"spacer"                    { this.begin('INITIAL'); return 'SPACER'; }
<INITIAL,line_start>"divider"                   { this.begin('INITIAL'); return 'DIVIDER'; }
<INITIAL,line_start>"Card"                      { this.begin('INITIAL'); return 'CARD'; }
<INITIAL,line_start>"Grid"                      { this.begin('INITIAL'); return 'GRID'; }
<INITIAL,line_start>"header"                   { this.begin('INITIAL'); return 'HEADER'; }
<INITIAL,line_start>\"[^\"]*\"                  { this.begin('INITIAL'); return 'STRING'; }
<INITIAL>"flex"\b                      return 'FLEX';
<INITIAL>"width"\b                     return 'WIDTH';
<INITIAL>"height"\b                    return 'HEIGHT';
<INITIAL>"padding"\b                   return 'PADDING';
<INITIAL>"align"\b                     return 'ALIGN';
<INITIAL>"cross"\b                     return 'CROSS';
<INITIAL>"primary"\b                   return 'PRIMARY';
<INITIAL>"secondary"\b                 return 'SECONDARY';
<INITIAL>"danger"\b                    return 'DANGER';
<INITIAL>"success"\b                   return 'SUCCESS';
<INITIAL>"disabled"\b                  return 'DISABLED';
<INITIAL>"start"\b                     return 'START';
<INITIAL>"center"\b                    return 'CENTER';
<INITIAL>"end"\b                       return 'END';
<INITIAL>"space-between"\b             return 'SPACE_BETWEEN';
<INITIAL>[0-9]+                      return 'NUMBER';
<INITIAL>"="                         return 'EQUALS';
<INITIAL,line_start><<EOF>>                     return 'EOF';
<INITIAL,line_start>.                           /* ignore */

/lex

%start diagram

%%

diagram
  : WIREFRAME viewport direction NEWLINE nodes trailingNewlines EOF
    { return { viewport: $2, direction: $3, nodes: $5 }; }
  ;

trailingNewlines
  : NEWLINE trailingNewlines
  |
  ;

viewport
  : MOBILE    { $$ = 'mobile'; }
  | TABLET    { $$ = 'tablet'; }
  | DESKTOP   { $$ = 'desktop'; }
  |           { $$ = 'default'; }
  ;

direction
  : TD        { $$ = 'TD'; }
  | LR        { $$ = 'LR'; }
  |           { $$ = 'LR'; }
  ;

modifierList
  : modifier modifierList  { $$ = Object.assign({}, $1, $2); }
  |                        { $$ = {}; }
  ;

modifier
  : FLEX EQUALS NUMBER  { $$ = { flex: parseInt($3) }; }
  | FLEX                { $$ = { flex: true }; }
  | WIDTH EQUALS NUMBER { $$ = { width: parseInt($3) }; }
  | HEIGHT EQUALS NUMBER { $$ = { height: parseInt($3) }; }
  | PADDING EQUALS NUMBER { $$ = { padding: parseInt($3) }; }
  | ALIGN EQUALS alignValue { $$ = { align: $3 }; }
  | CROSS EQUALS alignValue { $$ = { cross: $3 }; }
  | PRIMARY             { $$ = { variant: 'primary' }; }
  | SECONDARY           { $$ = { variant: 'secondary' }; }
  | DANGER              { $$ = { variant: 'danger' }; }
  | SUCCESS             { $$ = { variant: 'success' }; }
  | DISABLED            { $$ = { disabled: true }; }
  ;

alignValue
  : START           { $$ = 'start'; }
  | CENTER          { $$ = 'center'; }
  | END             { $$ = 'end'; }
  | SPACE_BETWEEN   { $$ = 'space-between'; }
  ;

nodes
  : nodes NEWLINE node  { $$ = $1.concat([$3]); }
  | node                { $$ = [$1]; }
  ;

node
  : INDENT containerNode
    { $$ = Object.assign({}, $2, { indent: $1.length }); }
  | INDENT widgetNode
    { $$ = Object.assign({}, $2, { indent: $1.length }); }
  | INDENT gridChild
    { $$ = Object.assign({}, $2, { indent: $1.length }); }
  ;

containerNode
  : COL modifierList  { $$ = { type: 'col', modifiers: $2, children: [] }; }
  | ROW modifierList  { $$ = { type: 'row', modifiers: $2, children: [] }; }
  | CARD modifierList { $$ = { type: 'Card', modifiers: $2, children: [] }; }
  | GRID modifierList { $$ = { type: 'Grid', modifiers: $2, children: [] }; }
  | SCREEN STRING     { $$ = { type: 'screen', label: $2.slice(1, -1), modifiers: {}, children: [] }; }
  | SCREEN            { $$ = { type: 'screen', label: '', modifiers: {}, children: [] }; }
  ;

gridChild
  : HEADER STRING
    { $$ = { type: 'grid-header', label: $2.slice(1, -1), modifiers: {}, children: [] }; }
  | ROW STRING
    { $$ = { type: 'grid-row', label: $2.slice(1, -1), modifiers: {}, children: [] }; }
  ;

widgetNode
  : TEXT STRING modifierList
    { $$ = { type: 'Text', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | TITLE STRING modifierList
    { $$ = { type: 'Title', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | BUTTON STRING modifierList
    { $$ = { type: 'Button', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | INPUT STRING modifierList
    { $$ = { type: 'Input', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | APPBAR STRING modifierList
    { $$ = { type: 'AppBar', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | CHECKBOX STRING modifierList
    { $$ = { type: 'Checkbox', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | RADIO STRING modifierList
    { $$ = { type: 'Radio', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | SWITCH STRING modifierList
    { $$ = { type: 'Switch', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | DROPDOWN STRING modifierList
    { $$ = { type: 'Dropdown', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | LIST STRING modifierList
    { $$ = { type: 'List', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | NAVMENU STRING modifierList
    { $$ = { type: 'NavMenu', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | BOTTOMNAV STRING modifierList
    { $$ = { type: 'BottomNav', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | FAB STRING modifierList
    { $$ = { type: 'FAB', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | ICON STRING modifierList
    { $$ = { type: 'Icon', label: $2.slice(1, -1), modifiers: $3, children: [] }; }
  | AVATAR modifierList
    { $$ = { type: 'Avatar', label: '', modifiers: $2, children: [] }; }
  | IMAGE modifierList
    { $$ = { type: 'Image', label: '', modifiers: $2, children: [] }; }
  | SPACER modifierList
    { $$ = { type: 'spacer', label: '', modifiers: $2, children: [] }; }
  | DIVIDER modifierList
    { $$ = { type: 'divider', label: '', modifiers: $2, children: [] }; }
  ;
