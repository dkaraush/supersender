import './logger';
import ConfigResolver from './config/resolver';
import ConfigLoader from './config/loader';
import ConfigManager from './config/manager';

// ConfigLoader.load('index.yaml')
//             .then(x => {
//                 x.tokenName = 'if-dev-313233123';
//                 x.actionName = 'confirm-mail';
//                 console.dir(ConfigResolver.resolve(x, 'request-validation'))

//                 x.request = {lang: 'ru'}
//                 console.dir(ConfigResolver.resolve(x, 'result'))
                    
//             })

ConfigManager.getInstance(true);