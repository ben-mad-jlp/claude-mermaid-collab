# Styling Showcase — H1

Intro paragraph with **bold**, *italic*, ***bold+italic***, ~~strikethrough~~, `inline code`, and a [link to example](https://example.com). Here is some trailing text to see line-height and wrapping at normal paragraph width so we can judge readability at the current max-width setting.

## Section — H2

Paragraph under H2. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

### Subsection — H3

Paragraph under H3. Nested section to verify the section-level indent stacks as headings get deeper.

#### Deeper — H4

Paragraph under H4.

##### Deeper still — H5

Paragraph under H5.

###### Deepest — H6

Paragraph under H6.

## Lists

### Unordered

- First item
- Second item with **bold** inside
  - Nested item
  - Nested item with `code`
    - Deeply nested
- Third item

### Ordered

1. Step one
2. Step two
   1. Sub-step
   2. Sub-step
3. Step three

### Task list

- [ ] Unchecked task
- [x] Checked task
- [ ] Another unchecked task
  - [x] Nested checked
  - [ ] Nested unchecked

## Blockquote

> This is a blockquote. It can contain **bold**, *italic*, and `code`.
>
> Multi-paragraph blockquotes should also render cleanly.
>
> > Nested blockquote inside the outer one.

## Code

Inline: use `const x = 42;` for a constant.

Fenced code block (TypeScript):

```ts
export function greet(name: string): string {
  const greeting = `Hello, ${name}!`;
  return greeting;
}

const result = greet('world');
console.log(result);
```

Fenced code block (Python):

```python
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print([fibonacci(i) for i in range(10)])
```

Fenced code block (plain text):

```text
plain preformatted text
  with indentation
  preserved
```

## Tables

| Column A | Column B | Column C |
|----------|:--------:|---------:|
| left     | center   | right    |
| cell 1   | cell 2   | cell 3   |
| `code`   | **bold** | *italic* |

## Horizontal rule

Text above the rule.

---

Text below the rule.

## Images and links

![Placeholder image](https://via.placeholder.com/300x120.png?text=Sample+Image)

A [link](https://example.com) and an autolink: <https://example.com>.

## Raw HTML / details

<details>
<summary>Click to expand</summary>

Hidden content inside a `<details>` element. Supports **bold** and `code`.

</details>

## Mixed content under H2

Paragraph one in this section.

- A list here
- with two items

> And a blockquote.

```js
const mixed = 'content';
```

Back to a paragraph to close out the section.

## Emphasis edge cases

Text with **bold**, then more **bold again**, and *italic* then *italic again*. Also ***both***.

## Final — long paragraph for width

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
