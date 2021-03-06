import React, { Component } from "react";
import DiffViewer from "react-diff-viewer";
import _ from "lodash";
import "./App.css";

export default class App extends Component {
	componentWillMount() {
		document.addEventListener("keydown", this.onStep);
	}

	componentWillUnmount() {
		document.removeEventListener("keydown", this.onStep);
	}

	state = { expected: "", actual: "" };

	render() {
		return (
			<div className="app">
				<div>
					<div className="debugger" onKeyDown={this.onStep}>
						<DiffViewer
							oldValue={this.state.expected}
							newValue={this.state.actual}
							splitView={true}
						/>
					</div>
					<div className="titles">
						<h1 className="title">NesTest</h1>
						<h1 className="title">NesCore</h1>
					</div>
					<i className="hint">Enter => Next page</i>
				</div>
			</div>
		);
	}

	onStep = (event) => {
		if (event.code !== "Enter") return;

		let diffs = [];
		for (let i = 0; i < 10; i++) diffs.push(window.getDiff());

		this.setState({
			expected: _(diffs)
				.map("expected")
				.join("\n"),
			actual: _(diffs)
				.map("actual")
				.join("\n")
		});
	};
}
