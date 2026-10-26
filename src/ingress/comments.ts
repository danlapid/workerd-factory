/**
 * The comment ingress leaves when a bug report arrives without a
 * reproduction. One comment per issue: re-runs update it in place via the
 * marker rather than stacking new ones.
 */

export function ingressCommentMarker(issueNumber: number): string {
	return `<!-- factory-ingress:${issueNumber} -->`;
}

export function formatReproductionRequest(author: string): string {
	return `Hi @${author}! This looks like a bug report, but it doesn't contain enough for a maintainer to reproduce the problem.

Could you add a minimal reproduction? The most useful forms are:

- a small code sample or a link to a repository that shows the problem,
- the exact command you ran and its full output, and
- the versions and configuration involved (what you run, on what platform, with which flags or settings).

A report a maintainer can run locally gets fixed far faster than one described in prose. Thanks!

*This classification was automated — a maintainer will take it from here.*`;
}
