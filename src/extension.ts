import * as fs from "fs";
import * as util from "util";
import * as vscode from "vscode";
import DocProvider from "./DocProvider";

const workerFarm = require("worker-farm");
const searchWorker = workerFarm(require.resolve("./searchWorker"));

const stat = util.promisify(fs.stat);

export function activate(context: vscode.ExtensionContext) {
  let JsonDocProvider = new DocProvider();
  // Register scheme
  context.subscriptions.push(
    vscode.Disposable.from(
      vscode.workspace.registerTextDocumentContentProvider(
        DocProvider.scheme,
        JsonDocProvider
      )
    )
  );

  let jsonPathCommand = vscode.commands.registerTextEditorCommand(
    "extension.jsonPath",
    async (editor: vscode.TextEditor) => {
      let contents: object | Array<any>; // JSON file contents
      try {
        let doc = editor.document;
        await checkDocument(doc);
        contents = JSON.parse(doc.getText());
      } catch (err) {
        vscode.window.showErrorMessage(`Error parsing JSON: ${err.message}`);
        return;
      }

      let inputBoxOptions: Partial<InputBoxParameters> = {
        prompt: "Enter JSON path",
        placeholder: "$.a[0].b.c",
        ignoreFocusOut: true,
      };
      const inputText = await vscode.window.showInputBox(inputBoxOptions);
      if (inputText && inputText.length > 0) {
        searchAndDisplayResults({ inputText, contents }, editor);
      }
    }
  );

  let jsonPathWithNodesCommand = vscode.commands.registerTextEditorCommand(
    "extension.jsonPathWithNodes",
    async (editor: vscode.TextEditor) => {
      let contents: object | Array<any>; // JSON file contents
      try {
        let doc = editor.document;
        await checkDocument(doc);
        contents = JSON.parse(doc.getText());
      } catch (err) {
        vscode.window.showErrorMessage(`Error parsing JSON: ${err.message}`);
        return;
      }

      let inputBoxOptions: Partial<InputBoxParameters> = {
        prompt: "Enter JSON path",
        placeholder: "$.a[0].b.c",
        ignoreFocusOut: true,
      };
      const inputText = await vscode.window.showInputBox(inputBoxOptions);
      if (inputText && inputText.length > 0) {
        searchAndDisplayResults({ inputText, contents, nodes: true }, editor);
      }
    }
  );

  // Register command
  context.subscriptions.push(jsonPathCommand, jsonPathWithNodesCommand);
}

interface SearchOptions {
  inputText: string;
  contents: object | any[];
  nodes?: boolean;
}

interface InputBoxParameters {
  title: string;
  step: number;
  totalSteps: number;
  value: string;
  prompt: string;
  placeholder: string;
  ignoreFocusOut: boolean;
}

async function checkDocument(doc: vscode.TextDocument) {
  // Check file size and prompt for confirmation
  if (doc.uri.scheme === "file") {
    if (!doc.uri.fsPath.endsWith(".json")) {
      throw new Error("file is not json.");
    }
    let fileStats = await stat(doc.uri.fsPath);
    let fileSizeInBytes = fileStats.size;
    if (fileSizeInBytes > 3000000) {
      // If over 3MB
      vscode.window.showWarningMessage(
        "Warning: this is a large file! Your JSON path query may take a long time to run."
      );
    }
  }
}

async function searchAndDisplayResults(
  { inputText, contents, nodes = false }: SearchOptions,
  editor: vscode.TextEditor
) {
  let searchPromise: Thenable<string[]> = vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Parsing JSON path...",
      cancellable: true,
    },
    () => {
      return new Promise((resolve, reject) => {
        searchWorker(
          {
            contents,
            inputText,
          },
          { nodes },
          (err: any, output: any) => {
            if (err) {
              let errorMessage = err.message;
              if (
                errorMessage.indexOf("Parse error") > -1 ||
                errorMessage.indexOf("Lexical error") > -1
              ) {
                errorMessage =
                  "Please make sure your JSON path expression is valid!";
              }
              vscode.window.showErrorMessage(errorMessage);
              reject(err);
            }
            resolve(output);
          }
        );
      });
    }
  );
  searchPromise.then(async (jsonMatches: string[]) => {
    let uri = DocProvider.encodeContent(jsonMatches);
    let jsonDoc = await vscode.workspace.openTextDocument(uri);
    try {
      await vscode.languages.setTextDocumentLanguage(jsonDoc, "json");
    } catch (error) {
      console.error(error);
    }
    if (editor.viewColumn && editor.viewColumn < 4) {
      await vscode.window.showTextDocument(jsonDoc, {
        preserveFocus: false,
        viewColumn: editor.viewColumn + 1,
      });
      showQueryInfoInStatusBar(inputText);
    }
  });
}

function showQueryInfoInStatusBar(jpQuery: string, timeout = 9) {
  const progressDone = `⣀`;
  const progressLeft = `⣿`;
  let progress = 0;

  const statusBarInfo = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );
  statusBarInfo.text = `JSON Path query executed: "${jpQuery}"\t${progressDone.repeat(
    progress
  )}${progressLeft.repeat(timeout - 1 - progress)}`;
  statusBarInfo.show();

  const statusBarUpdateInterval = setInterval(() => {
    progress++;
    statusBarInfo.text = `JSON Path query executed: "${jpQuery}"\t${progressDone.repeat(
      progress
    )}${progressLeft.repeat(timeout - 1 - progress)}`;
  }, 1000);

  setTimeout(() => {
    clearInterval(statusBarUpdateInterval);
    statusBarInfo.dispose();
  }, timeout * 1000);
}
