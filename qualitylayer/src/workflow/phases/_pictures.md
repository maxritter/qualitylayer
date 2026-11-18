# Pictures

Draw only when a reader learns more from a picture than from a paragraph or a table, and draw what you
read in the code, never from names alone.

- Give each diagram or artifact its own descriptive heading, such as `### When an order lookup is allowed`.
  A short caption can point out what matters in that view.
- Choose the direction and size that make the mechanism readable. Show decisions and label their outcomes.
  Use an overview and a detail when they answer different questions.
- Trace a single interaction with a sequence diagram, a lifecycle with `stateDiagram-v2`, and stored
  relationships with `erDiagram`. Use a table for comparisons and an artifact for a screen.
- Mark the one or two parts the reader must notice with `:::focal`; a before-and-after picture marks
  `:::new`, `:::changed` and `:::removed`. A second line after `<br/>` is a detail, drawn quieter.
- Set no colours or styles: QualityLayer draws every picture in one style, light and dark. `end`, `style`,
  `class` and `default` cannot be node ids.
