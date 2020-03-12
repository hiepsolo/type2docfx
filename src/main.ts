#!/usr/bin/env node

import * as fs from 'fs-extra';
import * as serializer from 'js-yaml';
import * as program from 'commander';
import { Parser } from './parser';
import { postTransform, insertClassReferenceForModule, insertInnerClassReference } from './postTransformer';
import { generateTOC } from './tocGenerator';
import { generatePackage } from './packageGenerator';
import { resolveIds } from './idResolver';
import { YamlModel } from './interfaces/YamlModel';
import { UidMapping } from './interfaces/UidMapping';
import { RepoConfig } from './interfaces/RepoConfig';
import { yamlHeader } from './common/constants';
import { flags } from './common/flags';
import { ReferenceMapping } from './interfaces/ReferenceMapping';
import { Context } from './converters/context';
import { Node } from './interfaces/TypeDocModel';

let pjson = require('../package.json');

let path: string;
let outputPath: string;
let repoConfigPath: string;
program
    .version(`v${pjson.version}`)
    .description('A tool to convert the json format api file generated by TypeDoc to yaml format output files for docfx.')
    .option('--hasModule', 'Add the option if the source repository contains module.')
    .option('--disableAlphabetOrder', 'Add the option if you want to disable the alphabet order in output yaml.')
    .option('--basePath [value]', 'Current base path to the repository.')
    .option('--sourceUrl [value]', 'Define the source repository address.')
    .option('--sourceBranch [value]', 'Define the branch of source repository.')
    .arguments('<inputFile> <outputFolder> [repoConfigureFile]')
    .action(function (input: string, output: string, repoConfig: string) {
        path = input;
        outputPath = output;
        repoConfigPath = repoConfig;
    })
    .parse(process.argv);

if (!path || !outputPath) {
    console.log('Error: The input file path and output folder path is not specified!');
    program.help();
}

let repoConfig: RepoConfig;
if (repoConfigPath && program.basePath) {
    if (fs.existsSync(repoConfigPath)) {
        let temp = JSON.parse(fs.readFileSync(repoConfigPath).toString());
        repoConfig = {
            repo: temp.repo,
            branch: temp.branch,
            basePath: program.basePath
        };
    } else {
        console.log(`Error: repository config file path {${repoConfigPath}} doesn't exit!`);
        program.help();
    }
}

if (!repoConfig && program.sourceUrl && program.sourceBranch && program.basePath) {
    repoConfig = {
        repo: program.sourceUrl,
        branch: program.sourceBranch,
        basePath: program.basePath
    };
}

if (program.disableAlphabetOrder) {
    flags.enableAlphabetOrder = false;
}

let json = null;
if (fs.existsSync(path)) {
    let dataStr = fs.readFileSync(path).toString();
    json = JSON.parse(dataStr) as Node;
} else {
    console.error(`API doc file ${path} doesn\'t exist.`);
    program.help();
}

const uidMapping: UidMapping = {};
const innerClassReferenceMapping = new Map<string, string[]>();

let collection: YamlModel[] = [];
if (json) {
    const context = new Context(repoConfig, '', '', json.name, new Map<string, string[]>());
    collection = new Parser().traverse(json, uidMapping, context);
}

if (!collection || collection.length === 0) {
    console.log("Warning: nothing genereatd.");
}

const referenceMappings: ReferenceMapping[] = [];
for (const rootElement of collection) {
    let referenceMapping = {};
    resolveIds(rootElement, uidMapping, referenceMapping);
    referenceMappings.push(referenceMapping);
}

const rootElementsForTOC = JSON.parse(JSON.stringify(collection));
const flattenElements = collection.map((rootElement, index) => {
    if (rootElement.uid.indexOf('constructor') >= 0) {
        return [];
    }

    return postTransform(rootElement, referenceMappings[index]);
}).reduce(function (a, b) {
    return a.concat(b);
}, []);

insertClassReferenceForModule(flattenElements);
console.log('Yaml dump start.');
fs.ensureDirSync(outputPath);

for (let transfomredClass of flattenElements) {
    // to add this to handle duplicate class and module under the same hierachy
    insertInnerClassReference(innerClassReferenceMapping, transfomredClass);
    transfomredClass = JSON.parse(JSON.stringify(transfomredClass));
    let filename = transfomredClass.items[0].uid.replace(`${transfomredClass.items[0].package}.`, '');
    filename = filename.split('(')[0];
    filename = filename.replace(/\//g, '.');
    console.log(`Dump ${outputPath}/${filename}.yml`);
    fs.writeFileSync(`${outputPath}/${filename}.yml`, `${yamlHeader}\n${serializer.safeDump(transfomredClass)}`);
}

console.log('Yaml dump end.');

const yamlModels: YamlModel[] = [];
flattenElements.forEach(element => {
    yamlModels.push(element.items[0]);
});

const packageIndex = generatePackage(yamlModels);
fs.writeFileSync(`${outputPath}/index.yml`, `${yamlHeader}\n${serializer.safeDump(packageIndex)}`);
console.log('Package index generated.');

const toc = generateTOC(rootElementsForTOC, flattenElements[0].items[0].package);
fs.writeFileSync(`${outputPath}/toc.yml`, serializer.safeDump(toc));
console.log('Toc generated.');
