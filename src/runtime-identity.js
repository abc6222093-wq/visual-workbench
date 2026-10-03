import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
// Capture once when the server starts; launchers compare against current disk code.
export function codeFingerprint(repoDir) {
 const hash=createHash('sha256');
 function visit(dir,prefix){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){if(e.isSymbolicLink())continue;const rel=`${prefix}/${e.name}`;if(e.isDirectory())visit(join(dir,e.name),rel);else if(/\.(js|html|css|json)$/.test(e.name))hash.update(rel).update(readFileSync(join(dir,e.name)).toString('utf8').replaceAll('\r\n','\n'));}}
 for(const dir of ['src','web'])visit(join(repoDir,dir),dir);
 hash.update(readFileSync(join(repoDir,'package.json')));
 return hash.digest('hex');
}
