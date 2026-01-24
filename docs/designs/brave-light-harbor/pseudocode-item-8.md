# Pseudocode: Item 8 - Move Clear Button, Remove Top Chat Bar

## Remove ChatBar

```
# DELETE: ui/src/components/ChatBar.tsx
# Remove all imports/usages of ChatBar from other components
```

## Updated InputControls

```
FUNCTION InputControls({ onSend, onClear, disabled }):
  [input, setInput] = useState('')
  
  FUNCTION handleSend():
    IF input.trim():
      onSend(input)
      setInput('')
  
  FUNCTION handleKeyDown(e):
    IF e.key === 'Enter' AND NOT e.shiftKey:
      e.preventDefault()
      handleSend()
  
  RETURN (
    <div className="input-controls">
      # Clear button on left
      <button 
        onClick={onClear}
        className="clear-btn"
        title="Clear messages"
        disabled={disabled}
      >
        <ClearIcon />
      </button>
      
      # Input field in middle
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
        className="message-input"
      />
      
      # Send button on right
      <button
        onClick={handleSend}
        disabled={disabled || !input.trim()}
        className="send-btn"
      >
        <SendIcon />
      </button>
    </div>
  )
```

## WorkspacePanel Layout Update

```
FUNCTION WorkspacePanel():
  [messageContent, setMessageContent] = useState(null)
  
  FUNCTION handleClear():
    setMessageContent(null)
  
  FUNCTION handleSend(message):
    # Send message to backend
    sendMessage(message)
  
  RETURN (
    <div className="workspace-panel">
      # NO ChatBar here anymore
      
      # Message area
      <div className="message-section">
        <MessageArea content={messageContent} />
      </div>
      
      # Terminal
      <div className="terminal-section">
        <EmbeddedTerminal config={terminalConfig} />
      </div>
      
      # Input at bottom with clear button
      <InputControls 
        onSend={handleSend}
        onClear={handleClear}
      />
    </div>
  )
```

## Styling

```css
.input-controls {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  border-top: 1px solid var(--border-color);
}

.clear-btn {
  padding: 0.5rem;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  cursor: pointer;
}

.message-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
}

.send-btn {
  padding: 0.5rem 1rem;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
}
```
