export interface Param {
  paramName: string;
  paramType?: string;       // 字符串数字 ID，如 '0'='String', '16'='Object'
  description?: string;
  checkType?: number;       // 1=必填, 2=可选
  isList?: boolean;         // 是否为数组
  children?: Param[];       // Object 类型的嵌套字段
  defaultValue?: string;
  example?: string;
  fileType?: string;
  resultMsg?: string;
  paramPosition?: number;
  paramOrigin?: number;
}

export interface InParamModelData {
  queryParam: Param[];
  bodyParam: Param[];
  formParam: Param[];
  headerParam: Param[];
  pathParam: Param[];
  binaryMessage?: unknown[];
}

export interface OutputResultItem {
  parameterName: string;
  dataType: string;         // Java 类型，如 'java.lang.String'
  content: string;
  isDynamic: number;
  children: OutputResultItem[];
}

export interface OutResultItem {
  resultValueId: string;
  outResultDemo: string;    // JSON 字符串
  outResultParams: unknown[];
  outResultComponentInfo: {
    resourceId: string;
    name: string;
    describe: string;
  };
  outputResultInfo: {
    resultName: string;
    resultTypeName: string; // 如 'application/json'
    items: OutputResultItem[];
  };
}

export interface MockResultField {
  name: string;
  type: string;             // Java 类型，如 'java.lang.String'
  description: string;
  isList: boolean;
  defaultValue?: string;
  fieldTypeOriginEnum: string;
  typeOrigin: number;
  children?: MockResultField[];
}

export interface InterfaceInfo {
  interfaceId: string;
  interfaceName: string;
  description: string;
  fullPath: string;
  httpMethodName: string;
  httpProtocolName?: string;
  interfaceStatusName: string;
  interfaceContentType?: string;
  interfaceVersion?: number;
  isMock?: number;
  modelId?: string;
  inParamModelData: InParamModelData;
  inParams?: Param[];
  outResults?: OutResultItem[];
  mockReturnResultExample?: MockResultField[];
  bodyRequestDemo?: string;
  gmtCreate?: string;
  gmtModified?: string;
  createUserName?: string;
  modifiedUserName?: string;
}

export interface Module {
  moduleId: string;
  moduleName: string;
  interfaceInfos: InterfaceInfo[];
}

export interface ProjectInfo {
  projectName: string;
  projectPath: string;
  description?: string;
  projectStatusName?: string;
}

export interface DictItem {
  dictNo: number;
  dictValue: string;
  dictValueDescription: string;
}

export interface ApiResponseData {
  projectInfo: ProjectInfo;
  modules: Module[];
  dict?: {
    inparam_data_type?: DictItem[];
    [key: string]: unknown[] | undefined;
  };
}

export interface ApiResponse {
  code: string;
  msg: string;
  error: unknown;
  data: ApiResponseData;
}


export interface CachedSource {
  name: string;
  data: ApiResponseData;
  fetchedAt: Date;
  apiUrl: string;
}
