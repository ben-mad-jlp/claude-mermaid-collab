#!/bin/bash

# Test: kodex-init SKILL.md file existence and structure

SKILL_FILE="/Users/benmaderazo/Code/claude-mermaid-collab/skills/kodex-init/SKILL.md"
TEST_PASSED=0
TEST_FAILED=0

echo "Testing kodex-init skill file..."
echo

# Test 1: File exists
if [ ! -f "$SKILL_FILE" ]; then
    echo "FAIL: SKILL.md file does not exist at $SKILL_FILE"
    TEST_FAILED=$((TEST_FAILED + 1))
else
    echo "PASS: SKILL.md file exists"
    TEST_PASSED=$((TEST_PASSED + 1))
fi

# Test 2: YAML frontmatter exists
if grep -q "^---$" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: YAML frontmatter markers found"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: YAML frontmatter markers not found"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

# Test 3: Required YAML fields exist
if grep -q "^name: kodex-init$" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: 'name: kodex-init' found in YAML"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: 'name: kodex-init' not found in YAML"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "description:" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: 'description' field found"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: 'description' field not found"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "user-invocable: true" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: 'user-invocable: true' found"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: 'user-invocable: true' not found"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "allowed-tools:" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: 'allowed-tools' field found"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: 'allowed-tools' field not found"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

# Test 4: All 4 steps documented
if grep -q "## Step 1:" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: Step 1 documented"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: Step 1 not documented"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "## Step 2:" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: Step 2 documented"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: Step 2 not documented"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "## Step 3:" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: Step 3 documented"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: Step 3 not documented"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "## Step 4:" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: Step 4 documented"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: Step 4 not documented"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

# Test 5: MCP tools reference
if grep -q "mcp__plugin_mermaid-collab_mermaid__kodex_create_topic" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: kodex_create_topic MCP tool referenced"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: kodex_create_topic MCP tool not referenced"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "mcp__plugin_mermaid-collab_mermaid__kodex_list_topics" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: kodex_list_topics MCP tool referenced"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: kodex_list_topics MCP tool not referenced"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

# Test 6: Exclusion patterns documented
if grep -q "Exclusion Patterns" "$SKILL_FILE" 2>/dev/null; then
    echo "PASS: Exclusion patterns documented"
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "FAIL: Exclusion patterns not documented"
    TEST_FAILED=$((TEST_FAILED + 1))
fi

# Summary
echo
echo "=========================================="
echo "Test Results:"
echo "Passed: $TEST_PASSED"
echo "Failed: $TEST_FAILED"
echo "=========================================="

if [ $TEST_FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi
