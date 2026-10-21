export interface CodexCandidate {executable:string;version:string|null;error:string|null}
export interface CodexModel {id:string;name:string;isDefault:boolean}
export interface CodexDiscovery {selected:{executable:string;version:string};candidates:CodexCandidate[];models:CodexModel[];planType:string|null}
