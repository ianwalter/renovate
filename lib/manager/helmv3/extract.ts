import is from '@sindresorhus/is';
import yaml from 'js-yaml';
import * as datasourceHelm from '../../datasource/helm';
import { logger } from '../../logger';
import { SkipReason } from '../../types';
import { ExtractConfig, PackageDependency, PackageFile } from '../common';

export function extractPackageFile(
  content: string,
  fileName: string,
  config: ExtractConfig
): PackageFile | null {
  let chart: {
    apiVersion: string;
    name: string;
    version: string;
    dependencies: Array<{ name: string; version: string; repository: string }>;
  };
  try {
    chart = yaml.safeLoad(content, { json: true });
    if (!(chart?.apiVersion && chart.name && chart.version)) {
      logger.debug(
        { fileName },
        'Failed to find required fields in Chart.yaml'
      );
      return null;
    }
    if (chart.apiVersion !== 'v2') {
      logger.debug(
        { fileName },
        'Unsupported Chart apiVersion. Only v2 is supported.'
      );
      return null;
    }
  } catch (err) {
    logger.debug({ fileName }, 'Failed to parse helm Chart.yaml');
    return null;
  }
  let deps: PackageDependency[] = [];
  if (!is.nonEmptyArray(chart?.dependencies)) {
    logger.debug({ fileName }, 'Chart has no dependencies');
    return null;
  }
  const validDependencies = chart.dependencies.filter(
    (dep) => is.nonEmptyString(dep.name) && is.nonEmptyString(dep.version)
  );
  if (!is.nonEmptyArray(validDependencies)) {
    logger.debug('Name and/or version missing for all dependencies');
    return null;
  }
  deps = validDependencies.map((dep) => {
    const res: PackageDependency = {
      depName: dep.name,
      currentValue: dep.version,
    };
    if (dep.repository) {
      res.registryUrls = [dep.repository];
      if (dep.repository.startsWith('@')) {
        const repoWithAtRemoved = dep.repository.slice(1);
        const alias = config.aliases[repoWithAtRemoved];
        if (alias) {
          res.registryUrls = [alias];
          return res;
        }

        res.skipReason = SkipReason.PlaceholderUrl;
      } else {
        try {
          const url = new URL(dep.repository);
          if (url.protocol === 'file:') {
            res.skipReason = SkipReason.LocalDependency;
          }
        } catch (err) {
          logger.debug({ err }, 'Error parsing url');
          res.skipReason = SkipReason.InvalidUrl;
        }
      }
    } else {
      res.skipReason = SkipReason.NoRepository;
    }
    return res;
  });
  const res = {
    deps,
    datasource: datasourceHelm.id,
  };
  return res;
}
