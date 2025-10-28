import {
  type ResourceList,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base.js';
import {
  AccessControlledService,
  DefaultSubjectResolver,
  MetaDataInjector,
  SubjectResolver,
  DefaultMetaDataInjector,
} from '@restorecommerce/acs-client';

export function resolves_subject<T extends ResourceList>(
  subjectResolver: SubjectResolver<T> = DefaultSubjectResolver<T>,
): any {
  return function (
    target: (request: T, ...args: any[]) => Promise<any>,
    context: ClassMethodDecoratorContext,
    fallback?: any,
  ) {
    const reflection = async function (this: AccessControlledService, request: T, ...args: any[]) {
      request = await subjectResolver(this, request, ...args);
      return await target.call(this, request, ...args);
    };

    if (fallback) {
      // A 3rd param?
      // fallback to decorator stage 1 or 2.
      // is it a pure function or a stage 2 descriptor? let's guess!
      target = fallback.value ?? fallback;
      fallback.value = reflection;
    }
    else {
      // lucky we are on stage 3 - simple:
      return reflection;
    }
  };
}

export function injects_meta_data<T extends ResourceList>(
  metaDataInjector: MetaDataInjector<T> = DefaultMetaDataInjector<T>,
): any {
  return function (
    target: (request: T, ...args: any[]) => Promise<any>,
    context: ClassMethodDecoratorContext,
    fallback?: any,
  ) {
    const reflection = async function (this: AccessControlledService, request: T, ...args: any[]) {
      request = await metaDataInjector(this, request, ...args);
      return await target.call(this, request, ...args);
    };

    if (fallback) {
      // A 3rd param?
      // fallback to decorator stage 1 or 2.
      // is it a pure function or a stage 2 descriptor? let's guess!
      target = fallback.value ?? fallback;
      fallback.value = reflection;
    }
    else {
      // lucky we are on stage 3 - simple:
      return reflection;
    }
  };
}