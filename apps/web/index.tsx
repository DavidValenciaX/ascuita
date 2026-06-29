/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import LegalPage from './components/legal/LegalPage';
import './firebase';

import privacyPolicyEn from '../../docs/privacy-policy-en.md?raw';
import privacyPolicyEs from '../../docs/privacy-policy-es.md?raw';
import termsEn from '../../docs/terms-en.md?raw';
import termsEs from '../../docs/terms-es.md?raw';

function getLegalRoute() {
  const path = window.location.pathname.replace(/\/+$/, '');

  switch (path) {
    case '/privacy':
      return (
        <LegalPage
          title="Privacy Policy"
          lang="en"
          content={privacyPolicyEn}
        />
      );
    case '/privacidad':
      return (
        <LegalPage
          title="Política de Privacidad"
          lang="es"
          content={privacyPolicyEs}
        />
      );
    case '/terms':
      return (
        <LegalPage
          title="Terms of Service"
          lang="en"
          content={termsEn}
        />
      );
    case '/terminos':
      return (
        <LegalPage
          title="Términos y Condiciones"
          lang="es"
          content={termsEs}
        />
      );
    default:
      return null;
  }
}

const legalRoute = getLegalRoute();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    {legalRoute ?? <App />}
  </React.StrictMode>
);
