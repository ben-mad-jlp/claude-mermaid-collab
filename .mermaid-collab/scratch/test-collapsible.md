# Collapsible Sections Test

This document tests the collapsible `<details>/<summary>` feature.

## Basic Example

<details>
<summary>Click me to expand</summary>

This is hidden content that appears when you click the summary.

It supports **bold**, *italic*, and `code` formatting.

</details>

## Multiple Sections

<details>
<summary>Section 1: Introduction</summary>

This is the introduction section. It contains some basic text to demonstrate that markdown rendering works inside collapsible sections.

- List item 1
- List item 2
- List item 3

</details>

<details>
<summary>Section 2: Code Example</summary>

Here's a code example:

```javascript
function hello() {
  console.log("Hello, World!");
}
```

</details>

<details>
<summary>Section 3: Table</summary>

| Column A | Column B | Column C |
|----------|----------|----------|
| Value 1  | Value 2  | Value 3  |
| Value 4  | Value 5  | Value 6  |

</details>

## Regular Content

This is regular content that is always visible.

> A blockquote for good measure.

## Initially Open Section

<details open>
<summary>This section starts expanded</summary>

The `open` attribute should make this section start in an expanded state.

</details>

## End

That's all for the collapsible test!
