use ratex_layout::{layout, LayoutOptions};
use ratex_parser::parser::parse;

fn layout_width(latex: &str, max_width_em: Option<f64>) -> ratex_layout::LayoutBox {
    let ast = parse(latex).expect("test LaTeX must parse");
    let mut options = LayoutOptions::default();
    options.max_width_em = max_width_em;
    layout(&ast, &options)
}

#[test]
fn wraps_at_top_level_relation_without_exceeding_width() {
    let unwrapped = layout_width("a+b+c+d=e+f+g+h", None);
    let wrapped = layout_width("a+b+c+d=e+f+g+h", Some(unwrapped.width / 2.0));

    assert!(wrapped.width <= unwrapped.width / 2.0 + 1e-9);
    assert!(wrapped.height > unwrapped.height);
}

#[test]
fn does_not_split_an_indivisible_fraction() {
    let wrapped = layout_width(r"\frac{a+b+c+d}{e+f+g+h}", Some(0.5));

    assert!(wrapped.width > 0.5);
    assert_eq!(
        wrapped.height,
        layout_width(r"\frac{a+b+c+d}{e+f+g+h}", None).height
    );
}

#[test]
fn explicit_rows_remain_multiline_when_auto_wrap_is_enabled() {
    let wrapped = layout_width(
        r"\begin{aligned} a&=b+c \\ d&=e+f \end{aligned}",
        Some(20.0),
    );
    let unwrapped = layout_width(r"\begin{aligned} a&=b+c \\ d&=e+f \end{aligned}", None);

    assert_eq!(wrapped.height, unwrapped.height);
    assert_eq!(wrapped.width, unwrapped.width);
}

#[test]
fn no_width_constraint_preserves_single_line_layout() {
    let without_constraint = layout_width("a+b+c=d+e+f", None);
    let with_large_constraint = layout_width("a+b+c=d+e+f", Some(100.0));

    assert_eq!(without_constraint.width, with_large_constraint.width);
    assert_eq!(without_constraint.height, with_large_constraint.height);
    assert_eq!(without_constraint.depth, with_large_constraint.depth);
}
