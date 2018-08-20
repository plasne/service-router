FROM owasp/modsecurity

# install pre-reqs
RUN apt-get update
RUN apt-get -y install curl git

# setup Apache site
WORKDIR /etc/apache2
RUN a2dissite 000-default.conf
COPY apache/ports.conf ports.conf
COPY apache/000-detect.conf sites-available/000-detect.conf
COPY apache/000-protect.conf sites-available/000-protect.conf
RUN a2enmod rewrite
RUN a2ensite 000-detect.conf
RUN a2ensite 000-protect.conf

# add the OWASP Top 10
RUN git clone https://github.com/SpiderLabs/owasp-modsecurity-crs /opt/owasp-modsecurity-crs
RUN ln -s /opt/owasp-modsecurity-crs/crs-setup.conf.example modsecurity.d/crs-setup.conf
RUN ln -s /opt/owasp-modsecurity-crs/rules modsecurity.d/rules
RUN echo "Include modsecurity.d/modsecurity.conf" > mods-available/modsecurity.conf
RUN echo "Include modsecurity.d/crs-setup.conf" >> mods-available/modsecurity.conf
RUN echo "Include modsecurity.d/rules/*.conf" >> mods-available/modsecurity.conf

# turn on rule engine
RUN sed -ie 's/^\s*SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/apache2/modsecurity.d/modsecurity.conf
#cat /var/log/modsec_audit.log

# install npm and node (v3.1 uses a development branch)
#RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
#RUN apt-get install -y nodejs
RUN curl -sSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
RUN echo "deb https://deb.nodesource.com/node_10.x bionic main" | tee /etc/apt/sources.list.d/nodesource.list
RUN echo "deb-src https://deb.nodesource.com/node_10.x bionic main" | tee -a /etc/apt/sources.list.d/nodesource.list
RUN apt-get update
RUN apt-get -y install nodejs

# install service-router
RUN mkdir /opt/service-router
WORKDIR /opt/service-router
COPY built ./
COPY config config/
COPY package.json package.json
COPY package-lock.json package-lock.json
RUN npm install

# configure

# execute
COPY process_monitor.sh process_monitor.sh
RUN chmod +x process_monitor.sh
CMD ./process_monitor.sh
