# Pseudocode: Item 4e - Collab Codex GUI Topic Editor + Draft Review

## TopicEditor Component

```
FUNCTION TopicEditor({ topicName, initialDocuments, onSave, onCancel }):
  [editedBy, setEditedBy] = useState('')
  [activeTab, setActiveTab] = useState('conceptual')
  [documents, setDocuments] = useState(initialDocuments || empty)
  
  handleSave(verify):
    IF editedBy empty: showError; RETURN
    await onSave(documents, editedBy, verify)
  
  RETURN (
    <NameInput value={editedBy} onChange={setEditedBy} />
    <DocumentTabs activeTab onTabChange={setActiveTab} />
    <CodeMirrorEditor 
      value={documents[activeTab]}
      onChange={(v) => setDocuments({...documents, [activeTab]: v})}
    />
    <Button onClick={() => handleSave(false)}>Save</Button>
    <Button onClick={() => handleSave(true)}>Save & Verify</Button>
  )
```

## DraftReviewPanel Component

```
FUNCTION DraftReviewPanel({ topicName, onApprove, onReject }):
  { draft, diff } = useDraft(topicName)
  [viewMode, setViewMode] = useState('diff')
  [approvedBy, setApprovedBy] = useState('')
  
  RETURN (
    <Alert "Draft Pending Approval" />
    <Context: triggerType, generatedAt, relatedFlag />
    <ToggleGroup: Current | Draft | Diff />
    IF viewMode == 'diff': <DraftDiffViewer />
    ELSE: <MarkdownRenderer content={viewMode content} />
    <NameInput value={approvedBy} />
    <Button onClick={() => onApprove(approvedBy)}>Approve</Button>
    <Button onClick={() => onReject(approvedBy, reason)}>Reject</Button>
  )
```
