import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";

const root=new URL("../../adamantium/plugins/node-red-contrib-adamantium-ide-shell/",import.meta.url);
const html=readFileSync(new URL("ide-shell.html",root),"utf8");
const css=readFileSync(new URL("resources/ide-shell.css",root),"utf8");
const pkg=JSON.parse(readFileSync(new URL("package.json",root),"utf8"));
const script=html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)?.[1];

test("editor-only package registers a real Node-RED editor plugin",()=>{
  assert.equal(pkg["node-red"].plugins["adamantium-ide-shell"],"ide-shell.html");
  assert.equal(Object.keys(pkg["node-red"].plugins).length,1);
  assert.ok(!pkg["node-red"].nodes);
  assert.ok(script);
  new Script(script,{filename:"ide-shell.js"});
  assert.match(script,/RED\.plugins\.registerPlugin/);
  assert.match(script,/RED\.sidebar\.addTab/);
});
test("local preferences and keyboard restoration are present",()=>{
  assert.match(script,/data-adi-focus/);
  assert.match(script,/event\.key==="Escape"/);
  assert.match(script,/event\.ctrlKey\|\|event\.metaKey/);
  assert.match(script,/adamantium\.ui\.shell\.r01/);
  assert.match(script,/"off", "dark", "light"/);
  assert.match(script,/state\.focus=false|focus:false/);
});
test("styling is opt-in; live flow runtime is untouched",()=>{
  assert.match(css,/html\[data-adamantium-shell="dark"\]/);
  assert.match(css,/html\[data-adamantium-shell="light"\]/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/prefers-reduced-motion/);
  assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|\.post\(|\/flows\b|\/nodes\b|deploy\(/i);
  assert.doesNotMatch(css,/@import|url\(https?:/i);
});
