TODO
* allow for changing in/out?
* support routing by header
* support HTTPS
* support blue/green
* support down only after x min
* removing declare statements won't remove from Endpoints
* add greenlock / LetsEncrypt
* add ModSecurity
* stop http and https from being on the same port
* support AB testing, like 10% of traffic down one route
* support connection draining
* support showing ModSecurity logs
* add router discovery service (ie. can give out all other nodes)
* are ports 9001,9002 out of use?
* is there vulnerability in the hostname
* allow endpoint.waf to be arbitrary URL
* support waf detection

Tests:
* 3xx redirects
* cookies
* CORS

Examples:
* show a control plane example (like manual region failover)


FROM centos:latest


#yum -y install gcc-c++ flex bison yajl yajl-devel curl-devel curl GeoIP-devel doxygen zlib-devel
#yum -y install gcc-c++ libtool pcre-devel git

# install prereqs
yum -y groupinstall "Development Tools"
yum -y install pcre-devel

# install ModSecurity
cd /opt/
git clone https://github.com/SpiderLabs/ModSecurity
cd ModSecurity
git checkout -b v3/master origin/v3/master
sh build.sh
git submodule init
git submodule update
./configure --prefix=/opt
make
make DESTDIR=/opt/libmodsecurity install

cp -v -R /opt/libmodsecurity/opt/bin/* /usr/bin
cp -v -R /opt/libmodsecurity/opt/lib/* /usr/lib
cp -v -R /opt/libmodsecurity/opt/include/* /usr/include

# install npm and node
curl --silent --location https://rpm.nodesource.com/setup_10.x | bash -
yum -y install nodejs

# install swig 3.0+
git clone https://github.com/swig/swig
cd swig
sh autogen.sh
./configure --prefix=/usr --without-clisp --without-maximum-compile-warnings
make
make install
install -v -m755 -d /usr/share/doc/swig-3.0.12
cp -v -R Doc/* /usr/share/doc/swig-3.0.12

# install modsecurity-nodejs
git clone https://github.com/manishmalik/Modsecurity-nodejs
cd Modsecurity-nodejs


CMD /bin/bash